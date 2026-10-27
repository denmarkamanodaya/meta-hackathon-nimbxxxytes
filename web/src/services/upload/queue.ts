// Upload queue: holds every picked file, uploads one file at a time, and exposes an immutable
// snapshot for React's useSyncExternalStore. It lives in the composition root, so uploads keep
// running while the user switches tabs.
import { ApiError } from '../api/client';
import { fingerprint } from './plan';
import { bytesPerSecond, type RateSample } from './rate';
import type { UploadProgress } from './upload-file';

/** Where a file is in the queue. */
export type UploadItemState = 'queued' | 'uploading' | 'done' | 'failed';

/** One picked file as the UI shows it. */
export interface UploadItem {
  /** Stable id: the file fingerprint. */
  id: string;
  name: string;
  sizeBytes: number;
  state: UploadItemState;
  loadedBytes: number;
  /** Current speed, or null before there are two readings. */
  bytesPerSecond: number | null;
  /** True when this upload continued parts saved by an earlier attempt. */
  resumed: boolean;
  /** Finished parts and all parts (0 / 0 before the upload starts). */
  partsDone: number;
  partsTotal: number;
  /** Human-readable reason of the last failure. */
  errorMessage: string | null;
  clipId: string | null;
}

/** Uploads one file and reports progress; `uploadFile` with its deps bound. */
export type UploadRunner = (
  file: File,
  onProgress: (progress: UploadProgress) => void,
) => Promise<{ clipId: string }>;

/** Subscribable queue of uploads. */
export interface UploadQueue {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly UploadItem[];
  /** Adds files; a file already queued, uploading or done is ignored, a failed one retried. */
  add: (files: readonly File[]) => void;
  /** Puts a failed item back in the queue; it resumes from its saved parts. */
  retry: (id: string) => void;
}

/** What `createUploadQueue` needs. */
export interface UploadQueueDeps {
  run: UploadRunner;
  /** Monotonic clock in ms (`performance.now`). */
  now: () => number;
  /** Speed window in ms. */
  rateWindowMs: number;
}

const failureMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Upload stopped unexpectedly';

/**
 * Creates an empty queue.
 * @param deps - Runner, clock and speed window.
 * @returns The queue.
 */
export function createUploadQueue(deps: UploadQueueDeps): UploadQueue {
  const files = new Map<string, File>();
  const listeners = new Set<() => void>();
  let items: readonly UploadItem[] = [];
  let samples: RateSample[] = [];

  function update(id: string, patch: Partial<UploadItem>) {
    items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    for (const listener of listeners) listener();
  }

  function onProgress(id: string, progress: UploadProgress) {
    const atMs = deps.now();
    samples = [...samples, { atMs, bytes: progress.loadedBytes }].filter(
      (sample) => atMs - sample.atMs <= deps.rateWindowMs,
    );
    update(id, {
      loadedBytes: progress.loadedBytes,
      resumed: progress.resumed,
      partsDone: progress.partsDone,
      partsTotal: progress.partsTotal,
      bytesPerSecond: bytesPerSecond(samples, atMs, deps.rateWindowMs),
    });
  }

  function pump() {
    if (items.some((item) => item.state === 'uploading')) return;
    const next = items.find((item) => item.state === 'queued');
    const file = next === undefined ? undefined : files.get(next.id);
    if (next === undefined || file === undefined) return;
    samples = [];
    update(next.id, { state: 'uploading', errorMessage: null, bytesPerSecond: null });
    deps.run(file, (progress) => {
      onProgress(next.id, progress);
    }).then(
      ({ clipId }) => {
        const partsTotal = items.find((item) => item.id === next.id)?.partsTotal ?? 0;
        update(next.id, { state: 'done', loadedBytes: file.size, bytesPerSecond: null, clipId, partsDone: partsTotal });
        pump();
      },
      (error: unknown) => {
        update(next.id, { state: 'failed', bytesPerSecond: null, errorMessage: failureMessage(error) });
        pump();
      },
    );
  }

  function retry(id: string) {
    if (items.find((item) => item.id === id)?.state !== 'failed') return;
    update(id, { state: 'queued' });
    pump();
  }

  function add(picked: readonly File[]) {
    for (const file of picked) {
      const id = fingerprint(file);
      if (items.some((item) => item.id === id)) {
        retry(id);
        continue;
      }
      files.set(id, file);
      const item: UploadItem = {
        id,
        name: file.name,
        sizeBytes: file.size,
        state: 'queued',
        loadedBytes: 0,
        bytesPerSecond: null,
        resumed: false,
        partsDone: 0,
        partsTotal: 0,
        errorMessage: null,
        clipId: null,
      };
      items = [...items, item];
    }
    for (const listener of listeners) listener();
    pump();
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => items,
    add,
    retry,
  };
}
