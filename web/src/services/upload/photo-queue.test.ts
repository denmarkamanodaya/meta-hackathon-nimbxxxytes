import { describe, expect, it } from 'vitest';
import { createPhotoQueue, fileSource, type PhotoSource } from './photo-queue';

const photo = (name: string) => fileSource(new File(['x'], name, { type: 'image/jpeg' }));

function controlled() {
  const pending: { name: string; resolve: () => void; reject: (error: Error) => void }[] = [];
  const send = (file: File) =>
    new Promise<void>((resolve, reject) => {
      pending.push({ name: file.name, resolve, reject });
    });
  return { pending, send };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createPhotoQueue', () => {
  it('sends three at a time, counts each done (a failure too), and resets after the batch', async () => {
    const { pending, send } = controlled();
    const failed: string[] = [];
    const queue = createPhotoQueue({ send, concurrency: 3, onFailed: (source) => failed.push(source.name) });

    const batch = queue.add(['a', 'b', 'c', 'd', 'e'].map(photo));
    await flush();

    expect(pending.map((each) => each.name)).toEqual(['a', 'b', 'c']);
    expect(queue.getSnapshot()).toEqual({ total: 5, done: 0, failed: 0 });

    pending[0]?.resolve();
    pending[1]?.reject(new Error('offline'));
    await flush();
    await flush();
    expect(pending.map((each) => each.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(queue.getSnapshot()).toEqual({ total: 5, done: 2, failed: 1 });

    for (const each of pending.slice(2)) each.resolve();
    expect(await batch).toEqual({ total: 5, done: 5, failed: 1 });
    expect(queue.getSnapshot()).toEqual({ total: 0, done: 0, failed: 0 });
    expect(failed).toEqual(['b']);
  });

  it('joins photos added while a batch runs into it', async () => {
    const { pending, send } = controlled();
    const queue = createPhotoQueue({ send, concurrency: 3 });
    const first = queue.add([photo('a')]);
    const second = queue.add([photo('b')]);

    expect(queue.getSnapshot().total).toBe(2);
    await flush();
    pending[0]?.resolve();
    pending[1]?.resolve();

    expect(await first).toEqual({ total: 2, done: 2, failed: 0 });
    expect(await second).toEqual({ total: 2, done: 2, failed: 0 });
  });

  it('reads a lazy source only when its upload starts, at most three at once', async () => {
    let reading = 0;
    let most = 0;
    const lazy = (name: string): PhotoSource => ({
      name,
      open: async () => {
        reading += 1;
        most = Math.max(most, reading);
        await flush();
        return new File(['x'], name, { type: 'image/jpeg' });
      },
    });
    const queue = createPhotoQueue({
      send: async () => {
        await flush();
        reading -= 1;
      },
      concurrency: 3,
    });

    const done = await queue.add(Array.from({ length: 20 }, (_, index) => lazy(`p${String(index)}.jpg`)));

    expect(done).toEqual({ total: 20, done: 20, failed: 0 });
    expect(most).toBe(3);
  });
});
