// The photo upload queue (mock PhotosMock, "Uploading 12 photos · 7 of 12"): many picked photos go
// up three at a time, each through `send` (register, then the file itself). An entry is a source
// whose bytes are read only when its upload starts (`open`), so a pick of hundreds of large photos
// on the Mac holds at most three in memory; the bytes are dropped once that upload settles. It keeps one batch's
// tally for the Gallery's card; a batch added while one runs joins it. A failed photo counts as done
// and as failed, so the card always finishes.

/** The batch's tally. */
export interface PhotoQueueState {
  /** Photos in this batch. */
  total: number;
  /** Photos sent or given up on. */
  done: number;
  failed: number;
}

/** One photo to send: its bytes are read when its turn comes. */
export interface PhotoSource {
  name: string;
  /** Reads the photo (a picked File at once; a Mac-picked path from the native side). */
  open: () => Promise<File>;
}

/**
 * A picked File as a source.
 * @param file - The file.
 * @returns The source.
 */
export const fileSource = (file: File): PhotoSource => ({ name: file.name, open: () => Promise.resolve(file) });

/** What the queue is built from. */
export interface PhotoQueueDeps {
  /** Sends one photo; rejects when it did not get there. */
  send: (file: File) => Promise<unknown>;
  /** Photos in flight at once (read and sending). */
  concurrency: number;
  /** Told after each photo that did not get there. */
  onFailed?: (source: PhotoSource, error: unknown) => void;
}

/** The queue. */
export interface PhotoQueue {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => PhotoQueueState;
  /** Queues the photos; resolves once every photo of the batch is done. */
  add: (sources: readonly PhotoSource[]) => Promise<PhotoQueueState>;
}

const IDLE: PhotoQueueState = { total: 0, done: 0, failed: 0 };

/**
 * Creates an empty queue.
 * @param deps - See `PhotoQueueDeps`.
 * @returns The queue.
 */
export function createPhotoQueue(deps: PhotoQueueDeps): PhotoQueue {
  const listeners = new Set<() => void>();
  const waiting: PhotoSource[] = [];
  let state = IDLE;
  let running = 0;
  let finished: ((settled: PhotoQueueState) => void)[] = [];

  const set = (next: PhotoQueueState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const pump = () => {
    while (running < deps.concurrency && waiting.length > 0) {
      const source = waiting.shift();
      if (source === undefined) break;
      running += 1;
      void source
        .open()
        .then((file) => deps.send(file))
        .then(
          () => {
            set({ ...state, done: state.done + 1 });
          },
          (error: unknown) => {
            deps.onFailed?.(source, error);
            set({ ...state, done: state.done + 1, failed: state.failed + 1 });
          },
        )
        .finally(() => {
          running -= 1;
          if (running === 0 && waiting.length === 0) {
            const settled = state;
            const waiters = finished;
            finished = [];
            set(IDLE);
            for (const resolve of waiters) resolve(settled);
          }
          pump();
        });
    }
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    add: (sources) => {
      if (sources.length === 0) return Promise.resolve(state);
      return new Promise((resolve) => {
        finished.push(resolve);
        waiting.push(...sources);
        set({ ...state, total: state.total + sources.length });
        pump();
      });
    },
  };
}
