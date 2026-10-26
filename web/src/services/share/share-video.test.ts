import { describe, expect, it, vi } from 'vitest';
import { createVideoSharer } from './share-video';

const okFetch = () =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['mp4']), { status: 200 }));

describe('createVideoSharer', () => {
  it('fetches the render and shares it as an MP4 file', async () => {
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    const fetchFn = okFetch();
    const sharer = createVideoSharer({ canShare: () => true, share }, fetchFn);

    const outcome = await sharer('https://s3/r.mp4', 'morning.mp4', 'Slow mornings');

    expect(outcome).toBe('shared');
    expect(fetchFn).toHaveBeenCalledWith('https://s3/r.mp4');
    const data = share.mock.calls[0]?.[0];
    expect(data?.title).toBe('Slow mornings');
    expect(data?.files?.[0]?.name).toBe('morning.mp4');
    expect(data?.files?.[0]?.type).toBe('video/mp4');
  });

  it('reports unsupported without fetching when the browser cannot share', async () => {
    const fetchFn = okFetch();

    const outcome = await createVideoSharer({}, fetchFn)('u', 'a.mp4', 't');

    expect(outcome).toBe('unsupported');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('reports unsupported when files cannot be shared, and cancelled when the user closes the sheet', async () => {
    expect(await createVideoSharer({ canShare: () => false, share: vi.fn() }, okFetch())('u', 'a.mp4', 't')).toBe(
      'unsupported',
    );
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    expect(await createVideoSharer({ canShare: () => true, share }, okFetch())('u', 'a.mp4', 't')).toBe('cancelled');
  });

  it('rejects with a typed error when the file cannot be fetched', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 }));

    const result = createVideoSharer({ canShare: () => true, share: vi.fn() }, fetchFn)('u', 'a.mp4', 't');

    await expect(result).rejects.toMatchObject({ code: 'PART_FAILED', status: 403 });
  });
});
