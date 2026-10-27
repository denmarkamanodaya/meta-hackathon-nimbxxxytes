import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createUploadQueue, type UploadRunner } from './queue';
import type { UploadProgress } from './upload-file';

const clip = (name: string, size = 10) => new File(['x'.repeat(size)], name, { lastModified: 1 });

/** Runner whose uploads the test finishes by hand. */
function manualRunner() {
  const pending: { file: File; progress: (p: UploadProgress) => void; resolve: (v: { clipId: string }) => void; reject: (e: unknown) => void }[] = [];
  const run = vi.fn<UploadRunner>().mockImplementation(
    (file, progress) =>
      new Promise((resolve, reject) => {
        pending.push({ file, progress, resolve, reject });
      }),
  );
  return { run, pending };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createUploadQueue', () => {
  it('uploads one file at a time, in pick order', async () => {
    const { run, pending } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });

    queue.add([clip('a.mp4'), clip('b.mp4')]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().map((i) => i.state)).toEqual(['uploading', 'queued']);
    pending[0]?.resolve({ clipId: 'c-a' });
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]?.[0].name).toBe('b.mp4');
    expect(queue.getSnapshot()[0]).toMatchObject({ state: 'done', clipId: 'c-a', loadedBytes: 10 });
  });

  it('reports progress and speed from the monotonic clock', () => {
    const { run, pending } = manualRunner();
    let now = 0;
    const queue = createUploadQueue({ run, now: () => now, rateWindowMs: 3000 });
    queue.add([clip('a.mp4', 4_000_000)]);

    pending[0]?.progress({ loadedBytes: 0, resumed: true, partsDone: 0, partsTotal: 2 });
    now = 2000;
    pending[0]?.progress({ loadedBytes: 2_000_000, resumed: true, partsDone: 1, partsTotal: 2 });

    expect(queue.getSnapshot()[0]).toMatchObject({
      loadedBytes: 2_000_000,
      bytesPerSecond: 1_000_000,
      resumed: true,
    });
  });

  it('marks a failed file with the error message and moves on to the next', async () => {
    const { run, pending } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });
    queue.add([clip('a.mp4'), clip('b.mp4')]);

    pending[0]?.reject(new ApiError('NETWORK_ERROR', 'Part upload lost the connection', null));
    await flush();

    expect(queue.getSnapshot()[0]).toMatchObject({
      state: 'failed',
      errorMessage: 'Part upload lost the connection',
    });
    expect(queue.getSnapshot()[1]?.state).toBe('uploading');
  });

  it('retries a failed file, and re-picking it also retries instead of duplicating', async () => {
    const { run, pending } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });
    const a = clip('a.mp4');
    queue.add([a]);
    pending[0]?.reject(new ApiError('TIMEOUT', 'slow', null));
    await flush();

    queue.add([a]);

    expect(queue.getSnapshot()).toHaveLength(1);
    expect(queue.getSnapshot()[0]?.state).toBe('uploading');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ignores a file that is already queued or uploading', () => {
    const { run } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });

    queue.add([clip('a.mp4')]);
    queue.add([clip('a.mp4')]);

    expect(queue.getSnapshot()).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers with a new snapshot on every change', () => {
    const { run } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });
    const listener = vi.fn();
    queue.subscribe(listener);
    const before = queue.getSnapshot();

    queue.add([clip('a.mp4')]);

    expect(listener).toHaveBeenCalled();
    expect(queue.getSnapshot()).not.toBe(before);
  });

  it('does not start a second file picked while one is uploading', () => {
    const { run } = manualRunner();
    const queue = createUploadQueue({ run, now: () => 0, rateWindowMs: 3000 });

    queue.add([clip('a.mp4')]);
    queue.add([clip('b.mp4')]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().map((i) => i.state)).toEqual(['uploading', 'queued']);
  });
});
