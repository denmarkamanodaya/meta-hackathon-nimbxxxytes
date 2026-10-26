import { describe, expect, it, vi } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { createRenderService, type RenderPorts } from './render-service.ts';

function ports(overrides: Partial<RenderPorts> = {}): RenderPorts {
  return {
    render: vi.fn<RenderPorts['render']>().mockResolvedValue('/tmp/x.mp4'),
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
    expect(p.upload).toHaveBeenCalledWith('/tmp/x.mp4', valid.out_url);
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
});
