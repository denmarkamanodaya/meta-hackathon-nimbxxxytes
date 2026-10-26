import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createToastStore, MAX_TOASTS, TOAST_MS, type Schedule } from './toast-store';

function manualSchedule() {
  const pending: { run: () => void; ms: number }[] = [];
  const schedule: Schedule = (run, ms) => {
    pending.push({ run, ms });
  };
  return { schedule, pending };
}

describe('createToastStore', () => {
  it('shows an error with its code and short message, and notifies subscribers', () => {
    const store = createToastStore(manualSchedule().schedule);
    const listener = vi.fn();
    store.subscribe(listener);

    store.error('Could not save the name', new ApiError('TIMEOUT', 'slow', null));

    expect(store.getSnapshot()).toEqual([
      { id: 1, tone: 'error', title: 'Could not save the name', text: 'The server took too long.', code: 'TIMEOUT' },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('dismisses itself after the toast time, or on demand', () => {
    const { schedule, pending } = manualSchedule();
    const store = createToastStore(schedule);
    store.info('Saved', 'v3 is ready');
    store.info('Saved', 'v4 is ready');

    expect(pending[0]?.ms).toBe(TOAST_MS);
    pending[0]?.run();
    expect(store.getSnapshot().map((t) => t.text)).toEqual(['v4 is ready']);

    store.dismiss(2);
    expect(store.getSnapshot()).toEqual([]);
  });

  it('keeps only the newest toasts', () => {
    const store = createToastStore(manualSchedule().schedule);

    for (let i = 0; i < MAX_TOASTS + 2; i += 1) store.info('n', String(i));

    expect(store.getSnapshot().map((t) => t.text)).toEqual(['2', '3', '4']);
  });
});
