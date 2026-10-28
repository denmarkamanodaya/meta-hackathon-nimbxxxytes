import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import coverSample from '../fixtures/cover_still.sample.json';

const renderStill = vi.fn();
const selectComposition = vi.fn();
vi.mock('@remotion/renderer', () => ({ renderMedia: vi.fn(), renderStill, selectComposition }));

const { createRemotionStill, createUpload, removeFile } = await import('./remotion-render.ts');
const { createRenderService } = await import('./render-service.ts');

let outDir = '';

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'nb-still-'));
  selectComposition.mockReset().mockResolvedValue({ id: 'CoverStill', width: 1080, height: 1920 });
  // Stands in for Chrome: writes a small JPEG where renderStill was told to.
  renderStill.mockReset().mockImplementation(async (options: { output: string }) => {
    await writeFile(options.output, Buffer.from('jpegbytes'));
    return {};
  });
});

describe('POST /still through the real ports (renderStill and fetch faked)', () => {
  it('selects CoverStill with the props, draws a quality-90 JPEG and PUTs it to out_url', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const service = createRenderService({
      render: vi.fn(),
      still: createRemotionStill({ serveUrl: '/bundle', outDir, timeoutMs: 30_000 }),
      upload: createUpload(fetchFn),
      remove: removeFile,
    });
    const outUrl = 'https://s3.example/covers/sh1/titled.jpg?sig=1';

    const reply = await service.handle('POST', '/still', { props: coverSample, out_url: outUrl });

    expect(reply).toEqual({ status: 200, body: { size: 9 } });
    expect(selectComposition).toHaveBeenCalledWith({ serveUrl: '/bundle', id: 'CoverStill', inputProps: coverSample });
    const options = renderStill.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      composition: { id: 'CoverStill', width: 1080, height: 1920 },
      serveUrl: '/bundle',
      inputProps: coverSample,
      imageFormat: 'jpeg',
      jpegQuality: 90,
      timeoutInMilliseconds: 30_000,
    });
    expect(String(options.output).startsWith(`${outDir}/`)).toBe(true);
    expect(String(options.output).endsWith('.jpg')).toBe(true);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(outUrl);
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('jpegbytes');
  });
});
