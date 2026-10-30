import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeleteOutcome } from '../core/bulk-delete';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import {
  useDeleteClips,
  useDeleteGalleryItems,
  useDeleteShort,
  useDeleteShorts,
  type DeleteOne,
  type DeleteRun,
} from './useDelete';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function probeOf(useRun: () => DeleteRun) {
  const probe: { current: DeleteRun | null } = { current: null };
  function Probe() {
    const handle = useRun();
    useEffect(() => {
      probe.current = handle;
    });
    return <output>{handle.isDeleting ? 'deleting' : 'idle'}</output>;
  }
  return { probe, Probe };
}

describe('useDeleteGalleryItems', () => {
  it('deletes each Gallery entry through its own endpoint, in order', async () => {
    const order: string[] = [];
    const deleteClip = vi.fn<ApiClient['deleteClip']>((id) => {
      order.push(`clip ${id}`);
      return Promise.resolve(true);
    });
    const deleteListen = vi.fn<ApiClient['deleteListen']>((id) => {
      order.push(`listen ${id}`);
      return Promise.resolve(true);
    });
    const deleteDocument = vi.fn<ApiClient['deleteDocument']>((id) => {
      order.push(`document ${id}`);
      return Promise.resolve(true);
    });
    const { probe, Probe } = probeOf(useDeleteGalleryItems);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ deleteClip, deleteListen, deleteDocument }) }));

    let outcome: DeleteOutcome | null = null;
    await act(async () => {
      outcome = (await probe.current?.run(['listen:l1', 'dog', 'doc:d1'])) ?? null;
    });

    expect(order).toEqual(['listen l1', 'clip dog', 'document d1']);
    expect(outcome).toEqual({ deleted: ['listen:l1', 'dog', 'doc:d1'], failed: [], firstError: null });
  });
});

describe('useDeleteClips', () => {
  it('sends DELETE for each clip in order, reports what stayed, and is busy only while it runs', async () => {
    const forbidden = new ApiError(ERROR.FORBIDDEN, 'not yours', 403);
    let release: () => void = () => undefined;
    const deleteClip = vi
      .fn<ApiClient['deleteClip']>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => {
              resolve(true);
            };
          }),
      )
      .mockRejectedValueOnce(forbidden)
      .mockResolvedValueOnce(true);
    const { probe, Probe } = probeOf(useDeleteClips);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ deleteClip }) }));

    let outcome: DeleteOutcome | undefined;
    let running: Promise<DeleteOutcome> | undefined;
    act(() => {
      running = probe.current?.run(['c1', 'c2', 'c3']);
    });
    expect(view.container.textContent).toBe('deleting');
    await act(async () => {
      release();
      outcome = await running;
    });

    expect(deleteClip.mock.calls).toEqual([['c1'], ['c2'], ['c3']]);
    expect(outcome).toEqual({ deleted: ['c1', 'c3'], failed: ['c2'], firstError: forbidden });
    expect(view.container.textContent).toBe('idle');
  });
});

function oneProbe<T>(useOne: () => DeleteOne<T>) {
  const probe: { current: DeleteOne<T> | null } = { current: null };
  function Probe() {
    const handle = useOne();
    useEffect(() => {
      probe.current = handle;
    });
    return <output>{handle.isDeleting ? 'deleting' : 'idle'}</output>;
  }
  return { probe, Probe };
}

describe('useDeleteShort', () => {
  it('toasts and resolves true once the short is gone, false when it stayed', async () => {
    const deleteShort = vi
      .fn<ApiClient['deleteShort']>()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new ApiError(ERROR.FORBIDDEN, 'not yours', 403));
    const services = fakeServices({ api: fakeApi({ deleteShort }) });
    const { probe, Probe } = oneProbe(useDeleteShort);
    view = await mount(<Probe />, services);

    const results: (boolean | undefined)[] = [];
    await act(async () => {
      results.push(await probe.current?.remove('s1'));
      results.push(await probe.current?.remove('s2'));
    });

    expect(results).toEqual([true, false]);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Short deleted', 'Could not delete the short']);
  });
});

describe('useDeleteShorts', () => {
  it('sends DELETE for the short', async () => {
    const deleteShort = vi.fn<ApiClient['deleteShort']>().mockResolvedValue(true);
    const { probe, Probe } = probeOf(useDeleteShorts);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ deleteShort }) }));

    let outcome: DeleteOutcome | undefined;
    await act(async () => {
      outcome = await probe.current?.run(['s1']);
    });

    expect(deleteShort).toHaveBeenCalledWith('s1');
    expect(outcome).toEqual({ deleted: ['s1'], failed: [], firstError: null });
  });
});
