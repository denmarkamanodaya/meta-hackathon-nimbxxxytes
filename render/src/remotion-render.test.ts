import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { ShortPropsSchema } from './composition/schema.ts';

const renderMedia = vi.fn();
const selectComposition = vi.fn();
vi.mock('@remotion/renderer', () => ({ renderMedia, selectComposition }));

const { createRemotionRender, createUpload } = await import('./remotion-render.ts');
const props = ShortPropsSchema.parse(sample);

beforeEach(() => {
  renderMedia.mockReset().mockResolvedValue({});
  selectComposition.mockReset().mockResolvedValue({ id: 'NimbytesShort', width: 1080, height: 1350 });
});

describe('createRemotionRender', () => {
  it('selects NimbytesShort with the props and renders h264 at the preview scale', async () => {
    const render = createRemotionRender({ serveUrl: '/bundle', outDir: '/tmp', timeoutMs: 120_000, concurrency: 3, videoCacheBytes: 512 * 1024 * 1024 });

    const file = await render(props, 'preview');

    expect(selectComposition).toHaveBeenCalledWith({ serveUrl: '/bundle', id: 'NimbytesShort', inputProps: props });
    const options = renderMedia.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).toMatchObject({
      codec: 'h264',
      serveUrl: '/bundle',
      inputProps: props,
      crf: 28,
      timeoutInMilliseconds: 120_000,
      concurrency: 3,
      offthreadVideoCacheSizeInBytes: 536_870_912,
    });
    expect(options.composition).toMatchObject({ id: 'NimbytesShort', width: 544, height: 680 });
    expect(options.scale).toBeUndefined();
    expect(file).toMatch(/^\/tmp\/.+\.mp4$/);
  });

  it('renders the final at full size with the higher quality encoder settings', async () => {
    await createRemotionRender({ serveUrl: '/b', outDir: '/tmp', timeoutMs: 1, concurrency: 2, videoCacheBytes: 256 * 1024 * 1024 })({ ...props, aspect: '1:1' }, 'final');

    expect(renderMedia.mock.calls[0]?.[0]).toMatchObject({
      composition: { width: 1080, height: 1080 },
      concurrency: 2,
      offthreadVideoCacheSizeInBytes: 268_435_456,
      crf: 18,
      x264Preset: 'medium',
    });
  });
});

describe('createUpload', () => {
  it('PUTs the MP4 bytes with a video content type and reports the size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nb-upload-'));
    const file = join(dir, 'a.mp4');
    await writeFile(file, Buffer.from('12345'));
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));

    const bytes = await createUpload(fetchFn)(file, 'https://s3.example/put?sig=1');

    expect(bytes).toBe(5);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://s3.example/put?sig=1');
    expect(init?.method).toBe('PUT');
    expect(init?.headers).toEqual({ 'Content-Type': 'video/mp4' });
  });

  it('rejects when storage refuses the upload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nb-upload-'));
    const file = join(dir, 'a.mp4');
    await writeFile(file, 'x');
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));

    await expect(createUpload(fetchFn)(file, 'https://s3.example/put')).rejects.toThrow('403');
  });
});
