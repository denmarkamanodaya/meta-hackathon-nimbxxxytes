import { describe, expect, it, vi } from 'vitest';
import coverSample from '../fixtures/cover_still.sample.json';
import sample from '../fixtures/props.sample.json';
import dog from '../fixtures/sam_mask_dog.json';
import plate from '../fixtures/sam_mask_plate.json';
import { maskToFramePath, type Mask } from './mask.ts';
import { createRenderService, type RenderPorts } from './render-service.ts';

function ports(overrides: Partial<RenderPorts> = {}): RenderPorts {
  return {
    render: vi.fn<RenderPorts['render']>().mockResolvedValue('/tmp/x.mp4'),
    still: vi.fn<RenderPorts['still']>().mockResolvedValue('/tmp/c.jpg'),
    cutout: vi.fn<RenderPorts['cutout']>().mockResolvedValue('/tmp/c.png'),
    upload: vi.fn<RenderPorts['upload']>().mockResolvedValue(1234),
    remove: vi.fn<RenderPorts['remove']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

const valid = { props: sample, quality: 'preview', out_url: 'https://s3.example/previews/sh1/v1.mp4?sig=x' };

describe('render service', () => {
  it('answers 400 VALIDATION_FAILED for an invalid body and renders nothing', async () => {
    const p = ports();
    const service = createRenderService(p);

    const reply = await service.handle('POST', '/render', { ...valid, quality: 'ultra' });

    expect(reply.status).toBe(400);
    expect(reply.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(p.render).not.toHaveBeenCalled();
  });

  it('renders the props at the quality, uploads to out_url, removes the file and reports length and size', async () => {
    const p = ports();

    const reply = await createRenderService(p).handle('POST', '/render', valid);

    expect(p.render).toHaveBeenCalledWith(expect.objectContaining({ aspect: '4:5' }), 'preview');
    expect(p.upload).toHaveBeenCalledWith('/tmp/x.mp4', valid.out_url, 'video/mp4');
    expect(p.remove).toHaveBeenCalledWith('/tmp/x.mp4');
    expect(reply).toEqual({ status: 200, body: { duration_s: 14.5, bytes: 1234 } });
  });

  it('answers 500 RENDER_FAILED when the upload fails, and still removes the file', async () => {
    const p = ports({ upload: vi.fn<RenderPorts['upload']>().mockRejectedValue(new Error('Upload answered 403')) });

    const reply = await createRenderService(p).handle('POST', '/render', valid);

    expect(reply).toEqual({ status: 500, body: { error: { code: 'RENDER_FAILED', message: 'Upload answered 403' } } });
    expect(p.remove).toHaveBeenCalled();
  });

  it('runs one render at a time', async () => {
    let active = 0;
    let peak = 0;
    const render = vi.fn<RenderPorts['render']>().mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return '/tmp/x.mp4';
    });
    const service = createRenderService(ports({ render }));

    await Promise.all([service.handle('POST', '/render', valid), service.handle('POST', '/render', valid)]);

    expect(render).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it('keeps serving after a failed render', async () => {
    const render = vi.fn<RenderPorts['render']>().mockRejectedValueOnce(new Error('chrome crashed')).mockResolvedValue('/tmp/y.mp4');
    const service = createRenderService(ports({ render }));

    expect((await service.handle('POST', '/render', valid)).status).toBe(500);
    expect((await service.handle('POST', '/render', valid)).status).toBe(200);
  });

  it('answers health and 404 for other routes', async () => {
    const service = createRenderService(ports());

    expect(await service.handle('GET', '/health', null)).toEqual({ status: 200, body: { ok: true } });
    expect((await service.handle('GET', '/render', null)).status).toBe(404);
  });

  it('runs renders and stills through one queue, one at a time', async () => {
    let active = 0;
    let peak = 0;
    const busy = async (path: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return path;
    };
    const service = createRenderService(
      ports({
        render: vi.fn<RenderPorts['render']>().mockImplementation(() => busy('/tmp/x.mp4')),
        still: vi.fn<RenderPorts['still']>().mockImplementation(() => busy('/tmp/c.jpg')),
      }),
    );

    const replies = await Promise.all([
      service.handle('POST', '/render', valid),
      service.handle('POST', '/still', { props: coverSample, out_url: 'https://s3.example/c.jpg?sig=1' }),
    ]);

    expect(replies.map((r) => r.status)).toEqual([200, 200]);
    expect(peak).toBe(1);
  });
});

describe('POST /still', () => {
  const still = { props: coverSample, out_url: 'https://s3.example/covers/sh1/titled.jpg?sig=x' };

  it('draws the still, uploads it as a JPEG to out_url, removes the file and reports its size', async () => {
    const p = ports();

    const reply = await createRenderService(p).handle('POST', '/still', still);

    expect(p.still).toHaveBeenCalledWith(coverSample);
    expect(p.upload).toHaveBeenCalledWith('/tmp/c.jpg', still.out_url, 'image/jpeg');
    expect(p.remove).toHaveBeenCalledWith('/tmp/c.jpg');
    expect(p.render).not.toHaveBeenCalled();
    expect(reply).toEqual({ status: 200, body: { size: 1234 } });
  });

  it('answers 400 VALIDATION_FAILED naming the field, and draws nothing', async () => {
    const p = ports();
    const service = createRenderService(p);

    const tooLong = await service.handle('POST', '/still', { ...still, props: { ...coverSample, title: { text: 'x'.repeat(33), position: 'bottom' } } });
    const noUrl = await service.handle('POST', '/still', { props: coverSample, out_url: 'not a url' });

    expect(tooLong.status).toBe(400);
    expect(JSON.stringify(tooLong.body)).toContain('"code":"VALIDATION_FAILED","message":"props.title.text: ');
    expect(noUrl.status).toBe(400);
    expect(JSON.stringify(noUrl.body)).toContain('"message":"out_url: ');
    expect(p.still).not.toHaveBeenCalled();
  });

  it('answers 500 RENDER_FAILED when drawing fails, and keeps serving', async () => {
    const p = ports({ still: vi.fn<RenderPorts['still']>().mockRejectedValueOnce(new Error('image 403')).mockResolvedValue('/tmp/c.jpg') });
    const service = createRenderService(p);

    expect(await service.handle('POST', '/still', still)).toEqual({ status: 500, body: { error: { code: 'RENDER_FAILED', message: 'image 403' } } });
    expect((await service.handle('POST', '/still', still)).status).toBe(200);
  });
});

const framePath = (mask: Mask, box: typeof plate.box): string => {
  const outline = maskToFramePath(mask, box);
  if (!outline.ok) throw new Error(outline.message);
  return outline.path;
};

describe('POST /mask/path', () => {
  it('answers the outline in frame pixels without queueing behind a render', async () => {
    let finishRender = (): void => undefined;
    const render = vi.fn<RenderPorts['render']>().mockReturnValue(
      new Promise((resolve) => {
        finishRender = () => {
          resolve('/tmp/x.mp4');
        };
      }),
    );
    const service = createRenderService(ports({ render }));
    const rendering = service.handle('POST', '/render', valid);

    const reply = await service.handle('POST', '/mask/path', { mask: dog.mask, box: dog.box });

    expect(reply).toEqual({ status: 200, body: { path: framePath(dog.mask as Mask, dog.box) } });
    expect((reply.body as { path: string }).path).toMatch(/^M108 149.5L108.5 149L/);
    finishRender();
    await rendering;
  });

  it('answers 400 VALIDATION_FAILED for a bad box, a mask that is not the box, or a payload that does not decode', async () => {
    const service = createRenderService(ports());

    const backwards = await service.handle('POST', '/mask/path', { mask: plate.mask, box: { ...plate.box, x2: 10 } });
    const wrongSize = await service.handle('POST', '/mask/path', { mask: plate.mask, box: dog.box });
    const garbage = await service.handle('POST', '/mask/path', { mask: { ...plate.mask, payload: '!!!!!:"' }, box: plate.box });
    const badEncoding = await service.handle('POST', '/mask/path', { mask: { ...plate.mask, encoding: 'rle' }, box: plate.box });

    for (const reply of [backwards, wrongSize, garbage, badEncoding]) {
      expect(reply.status).toBe(400);
      expect(reply.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(JSON.stringify(backwards.body)).toContain('"message":"box: x2/y2 must not be before x1/y1"');
    expect(JSON.stringify(wrongSize.body)).toContain('"message":"mask: mask is 35x18, the box is not"');
    expect(JSON.stringify(garbage.body)).toContain('"message":"mask: ');
    expect(JSON.stringify(badEncoding.body)).toContain('"message":"mask.encoding: ');
  });
});

describe('POST /cutout', () => {
  const cutout = {
    image_url: 'https://media.example/frames/clip_dog_3.jpg?sig=1',
    frame: dog.frame,
    mask: dog.mask,
    box: dog.box,
    sticker: true,
    out_url: 'https://r2.example/cutouts/c1/sticker.png?sig=2',
  };

  it('draws the cut-out with the decoded outline, uploads a PNG and answers its size', async () => {
    const p = ports();

    const reply = await createRenderService(p).handle('POST', '/cutout', cutout);

    expect(p.cutout).toHaveBeenCalledWith({
      image_url: cutout.image_url,
      frame: { w: 240, h: 426 },
      path: framePath(dog.mask as Mask, dog.box),
      box: { x1: 16, y1: 149, x2: 239, y2: 425 },
      sticker: true,
    });
    expect(p.upload).toHaveBeenCalledWith('/tmp/c.png', cutout.out_url, 'image/png');
    expect(p.remove).toHaveBeenCalledWith('/tmp/c.png');
    expect(reply).toEqual({ status: 200, body: { size: 1234 } });
  });

  it('answers 400 for a box outside the frame or a bad mask, and draws nothing', async () => {
    const p = ports();
    const service = createRenderService(p);

    const outside = await service.handle('POST', '/cutout', { ...cutout, frame: { w: 239, h: 426 } });
    const badMask = await service.handle('POST', '/cutout', { ...cutout, mask: plate.mask });
    const noUrl = await service.handle('POST', '/cutout', { ...cutout, out_url: 'nope' });

    expect(JSON.stringify(outside.body)).toContain('"code":"VALIDATION_FAILED","message":"box: box must lie inside the frame"');
    expect(badMask.status).toBe(400);
    expect(noUrl.status).toBe(400);
    expect(p.cutout).not.toHaveBeenCalled();
  });

  it('runs in the render queue, after a render that is already running', async () => {
    const order: string[] = [];
    const render = vi.fn<RenderPorts['render']>().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('render');
      return '/tmp/x.mp4';
    });
    const draw = vi.fn<RenderPorts['cutout']>().mockImplementation(() => {
      order.push('cutout');
      return Promise.resolve('/tmp/c.png');
    });
    const service = createRenderService(ports({ render, cutout: draw }));

    await Promise.all([service.handle('POST', '/render', valid), service.handle('POST', '/cutout', cutout)]);

    expect(order).toEqual(['render', 'cutout']);
  });
});
