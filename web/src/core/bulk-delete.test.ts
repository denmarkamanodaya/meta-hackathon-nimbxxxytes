import { describe, expect, it, vi } from 'vitest';
import { clipDeleteToast, deleteInOrder } from './bulk-delete';

describe('deleteInOrder', () => {
  it('deletes one at a time in order and keeps going after a failure', async () => {
    const calls: string[] = [];
    let running = 0;
    const boom = new Error('403');
    const remove = vi.fn(async (id: string) => {
      running += 1;
      expect(running).toBe(1);
      calls.push(id);
      await Promise.resolve();
      running -= 1;
      if (id === 'b' || id === 'd') throw id === 'b' ? boom : new Error('later');
    });

    const outcome = await deleteInOrder(['a', 'b', 'c', 'd'], remove);

    expect(calls).toEqual(['a', 'b', 'c', 'd']);
    expect(outcome).toEqual({ deleted: ['a', 'c'], failed: ['b', 'd'], firstError: boom });
  });
});

describe('clipDeleteToast', () => {
  it('says what went', () => {
    expect(clipDeleteToast({ deleted: ['a'], failed: [], firstError: null })).toEqual({ tone: 'info', title: 'Clip deleted' });
    expect(clipDeleteToast({ deleted: ['a', 'b', 'c'], failed: [], firstError: null })).toEqual({ tone: 'info', title: '3 clips deleted' });
  });

  it('reports failures with the first error', () => {
    const error = new Error('x');

    expect(clipDeleteToast({ deleted: [], failed: ['a'], firstError: error })).toEqual({ tone: 'error', title: 'Could not delete the clip', error });
    expect(clipDeleteToast({ deleted: ['a', 'c'], failed: ['b'], firstError: error })).toEqual({
      tone: 'error',
      title: 'Could not delete 1 of 3 clips',
      error,
    });
  });
});
