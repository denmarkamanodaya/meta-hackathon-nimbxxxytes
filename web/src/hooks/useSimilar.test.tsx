import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeleteOutcome } from '../core/bulk-delete';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useKeepClip, useRemoveCopies, type KeepClip, type RemoveCopies } from './useSimilar';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function probeOf<T>(useIt: () => T, show: (handle: T) => string) {
  const probe: { current: T | null } = { current: null };
  function Probe() {
    const handle = useIt();
    useEffect(() => {
      probe.current = handle;
    });
    return <output>{show(handle)}</output>;
  }
  return { probe, Probe };
}

describe('useKeepClip', () => {
  it('POSTs keep, toasts, and resolves true; a refusal toasts and resolves false', async () => {
    const keepClip = vi
      .fn<ApiClient['keepClip']>()
      .mockResolvedValueOnce({ clip_id: 'c1', status: 'processing' })
      .mockRejectedValueOnce(new ApiError(ERROR.VALIDATION_FAILED, 'not a near-copy', 400));
    const services = fakeServices({ api: fakeApi({ keepClip }) });
    const { probe, Probe } = probeOf<KeepClip>(useKeepClip, (h) => (h.isKeeping ? 'keeping' : 'idle'));
    view = await mount(<Probe />, services);

    const results: (boolean | undefined)[] = [];
    await act(async () => {
      results.push(await probe.current?.keep('c1'));
      results.push(await probe.current?.keep('c2'));
    });

    expect(keepClip.mock.calls).toEqual([['c1'], ['c2']]);
    expect(results).toEqual([true, false]);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Kept both', 'Could not keep this clip']);
    expect(view.container.textContent).toBe('idle');
  });
});

describe('useRemoveCopies', () => {
  it('deletes each copy in order, counts progress, keeps going past a failure and toasts which stayed', async () => {
    const forbidden = new ApiError(ERROR.FORBIDDEN, 'not yours', 403);
    let release: () => void = () => undefined;
    const deleteClip = vi
      .fn<ApiClient['deleteClip']>()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            release = () => {
              reject(forbidden);
            };
          }),
      )
      .mockResolvedValueOnce(true);
    const services = fakeServices({ api: fakeApi({ deleteClip }) });
    const { probe, Probe } = probeOf<RemoveCopies>(useRemoveCopies, (h) => (h.progress === null ? 'idle' : `${String(h.progress.done)}/${String(h.progress.total)}`));
    view = await mount(<Probe />, services);

    let running: Promise<DeleteOutcome> | undefined;
    await act(async () => {
      running = probe.current?.remove(['a', 'b', 'c']);
      await Promise.resolve();
    });
    expect(view.container.textContent).toBe('1/3');
    let outcome: DeleteOutcome | undefined;
    await act(async () => {
      release();
      outcome = await running;
    });

    expect(deleteClip.mock.calls).toEqual([['a'], ['b'], ['c']]);
    expect(outcome).toEqual({ deleted: ['a', 'c'], failed: ['b'], firstError: forbidden });
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not remove 1 of 3 copies']);
    expect(view.container.textContent).toBe('idle');
  });

  it('toasts "3 copies removed" when all went', async () => {
    const deleteClip = vi.fn<ApiClient['deleteClip']>().mockResolvedValue(true);
    const services = fakeServices({ api: fakeApi({ deleteClip }) });
    const { probe, Probe } = probeOf<RemoveCopies>(useRemoveCopies, () => '');
    view = await mount(<Probe />, services);

    await act(async () => {
      await probe.current?.remove(['a', 'b', 'c']);
    });

    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['3 copies removed']);
  });
});
