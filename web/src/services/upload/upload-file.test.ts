import { describe, expect, it, vi } from 'vitest';
import { createMemoryResumeStore } from '../../test-support/memory-resume-store';
import { ApiError, type ApiClient } from '../api/client';
import { ERROR } from '../api/types';
import type { PutPart } from './put-part';
import { uploadFile, type UploadFileDeps } from './upload-file';

// 20-byte file, 8-byte parts: parts 1 [0,8) 2 [8,16) 3 [16,20).
const file = new File(['abcdefghijklmnopqrst'], 'pov.mp4', { type: 'video/mp4', lastModified: 1700 });
const KEY = 'pov.mp4|20|1700';
const urls = (ns: number[]) => ns.map((n) => ({ n, url: `https://s3.example/p${String(n)}` }));

function makeApi(overrides: Partial<UploadFileDeps['api']> = {}) {
  return {
    createUpload: vi.fn<ApiClient['createUpload']>().mockResolvedValue({
      upload_id: 'up1',
      clip_id: 'clip1',
      part_size: 8,
      parts: urls([1, 2, 3]),
    }),
    presignParts: vi
      .fn<ApiClient['presignParts']>()
      .mockImplementation((_id, ns) => Promise.resolve({ parts: urls(ns) })),
    completeUpload: vi
      .fn<ApiClient['completeUpload']>()
      .mockResolvedValue({ clip_id: 'clip1', status: 'uploaded' }),
    ...overrides,
  };
}

const okPut = () =>
  vi.fn<PutPart>().mockImplementation((url) => Promise.resolve(`"etag-${url.slice(-2)}"`));

function deps(api: UploadFileDeps['api'], putPart: PutPart, store = createMemoryResumeStore().store) {
  return { api, store, putPart, sleep: () => Promise.resolve(), concurrency: 3, maxAttempts: 3, retryBaseMs: 1 };
}

describe('uploadFile', () => {
  it('creates the upload with the file name, size and type', async () => {
    const api = makeApi();

    await uploadFile(file, deps(api, okPut()), vi.fn());

    expect(api.createUpload).toHaveBeenCalledWith({
      filename: 'pov.mp4',
      size_bytes: 20,
      content_type: 'video/mp4',
    });
  });

  it('sends each byte range to its URL and completes with every ETag in part order', async () => {
    const api = makeApi();
    const putPart = okPut();

    const result = await uploadFile(file, deps(api, putPart), vi.fn());

    const sent = await Promise.all(
      putPart.mock.calls.map(async ([url, body]) => [url, await body.text()]),
    );
    expect(sent.sort()).toEqual([
      ['https://s3.example/p1', 'abcdefgh'],
      ['https://s3.example/p2', 'ijklmnop'],
      ['https://s3.example/p3', 'qrst'],
    ]);
    expect(api.completeUpload).toHaveBeenCalledWith('up1', [
      { n: 1, etag: '"etag-p1"' },
      { n: 2, etag: '"etag-p2"' },
      { n: 3, etag: '"etag-p3"' },
    ]);
    expect(result).toEqual({ clipId: 'clip1' });
  });

  it('never has more than `concurrency` parts in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const putPart = vi.fn<PutPart>().mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return '"e"';
    });

    await uploadFile(file, { ...deps(makeApi(), putPart), concurrency: 2 }, vi.fn());

    expect(peak).toBe(2);
  });

  it('resumes: re-presigns only the missing parts and skips create', async () => {
    const { store } = createMemoryResumeStore({
      [KEY]: { uploadId: 'up1', clipId: 'clip1', partSizeBytes: 8, doneParts: [{ n: 1, etag: '"a"' }, { n: 3, etag: '"c"' }] },
    });
    const api = makeApi();
    const putPart = okPut();
    const onProgress = vi.fn();

    await uploadFile(file, deps(api, putPart, store), onProgress);

    expect(api.createUpload).not.toHaveBeenCalled();
    expect(api.presignParts).toHaveBeenCalledWith('up1', [2]);
    expect(putPart.mock.calls.map(([url]) => url)).toEqual(['https://s3.example/p2']);
    expect(onProgress).toHaveBeenNthCalledWith(1, { loadedBytes: 12, resumed: true });
    expect(api.completeUpload).toHaveBeenCalledWith('up1', [
      { n: 1, etag: '"a"' },
      { n: 2, etag: '"etag-p2"' },
      { n: 3, etag: '"c"' },
    ]);
  });

  it('starts over when the server no longer knows the saved upload', async () => {
    const { store } = createMemoryResumeStore({
      [KEY]: { uploadId: 'gone', clipId: 'old', partSizeBytes: 8, doneParts: [{ n: 1, etag: '"a"' }] },
    });
    const notFound = new ApiError(ERROR.NOT_FOUND, 'no such upload', 404);
    const api = makeApi({ presignParts: vi.fn<ApiClient['presignParts']>().mockRejectedValue(notFound) });

    const result = await uploadFile(file, deps(api, okPut(), store), vi.fn());

    expect(api.createUpload).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ clipId: 'clip1' });
  });

  it('saves each finished part, keeps them when a part fails, and clears them on success', async () => {
    const { store, entries } = createMemoryResumeStore();
    const failing = vi.fn<PutPart>().mockImplementation((url) =>
      url.endsWith('p2')
        ? Promise.reject(new ApiError('NETWORK_ERROR', 'offline', null))
        : Promise.resolve(`"etag-${url.slice(-2)}"`),
    );

    await expect(uploadFile(file, deps(makeApi(), failing, store), vi.fn())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    const saved = entries.get(KEY);
    expect(saved?.doneParts.map((p) => p.n).sort()).toEqual([1, 3]);
    expect(failing.mock.calls.filter(([url]) => url.endsWith('p2'))).toHaveLength(3);

    await uploadFile(file, deps(makeApi(), okPut(), store), vi.fn());
    expect(entries.has(KEY)).toBe(false);
  });

  it('re-presigns a part whose URL expired (S3 403) before retrying it', async () => {
    const api = makeApi();
    const putPart = vi
      .fn<PutPart>()
      .mockRejectedValueOnce(new ApiError('PART_FAILED', 'expired', 403))
      .mockResolvedValue('"e"');

    await uploadFile(file, { ...deps(api, putPart), concurrency: 1 }, vi.fn());

    expect(api.presignParts).toHaveBeenCalledWith('up1', [1]);
  });

  it('drops the saved state when complete says the upload is incomplete', async () => {
    const { store, entries } = createMemoryResumeStore();
    const incomplete = new ApiError(ERROR.UPLOAD_INCOMPLETE, 'part 2 missing', 409);
    const api = makeApi({ completeUpload: vi.fn<ApiClient['completeUpload']>().mockRejectedValue(incomplete) });

    await expect(uploadFile(file, deps(api, okPut(), store), vi.fn())).rejects.toBe(incomplete);

    expect(entries.has(KEY)).toBe(false);
  });

  it('aborts the other parts in flight when one part fails for good', async () => {
    const signals: AbortSignal[] = [];
    const putPart = vi.fn<PutPart>().mockImplementation((url, _body, _progress, signal) => {
      if (url.endsWith('p1')) return Promise.reject(new ApiError('NETWORK_ERROR', 'offline', null));
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });

    await expect(uploadFile(file, deps(makeApi(), putPart), vi.fn())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

