import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeleteOutcome } from '../core/bulk-delete';
import { ApiError, type ApiClient } from '../services/api/client';
import { ERROR, type ProductionDetail } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import {
  useDeleteClips,
  useDeleteProduction,
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

const productionWithShort = (shortId: string | null) =>
  ({ production: { production_id: 'p1', short_id: shortId } }) as unknown as ProductionDetail;

describe('useDeleteProduction', () => {
  it('looks up the story short first, then deletes the production and then the short', async () => {
    const calls: string[] = [];
    const getProduction = vi.fn<ApiClient['getProduction']>(() => {
      calls.push('get p1');
      return Promise.resolve(productionWithShort('s9'));
    });
    const deleteProduction = vi.fn<ApiClient['deleteProduction']>((id) => {
      calls.push(`delete production ${id}`);
      return Promise.resolve(true);
    });
    const deleteShort = vi.fn<ApiClient['deleteShort']>((id) => {
      calls.push(`delete short ${id}`);
      return Promise.resolve(true);
    });
    const services = fakeServices({ api: fakeApi({ getProduction, deleteProduction, deleteShort }) });
    const { probe, Probe } = oneProbe(useDeleteProduction);
    view = await mount(<Probe />, services);

    let isDone: boolean | undefined;
    await act(async () => {
      isDone = await probe.current?.remove({ productionId: 'p1', alsoShort: true });
    });

    expect(calls).toEqual(['get p1', 'delete production p1', 'delete short s9']);
    expect(isDone).toBe(true);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Production and its short deleted']);
  });

  it('leaves the short alone when the box is not ticked, and skips the lookup when the short is known', async () => {
    const getProduction = vi.fn<ApiClient['getProduction']>();
    const deleteProduction = vi.fn<ApiClient['deleteProduction']>().mockResolvedValue(true);
    const deleteShort = vi.fn<ApiClient['deleteShort']>().mockResolvedValue(true);
    const { probe, Probe } = oneProbe(useDeleteProduction);
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getProduction, deleteProduction, deleteShort }) }));

    await act(async () => {
      await probe.current?.remove({ productionId: 'p1', alsoShort: false, shortId: 's9' });
      await probe.current?.remove({ productionId: 'p2', alsoShort: true, shortId: 's2' });
    });

    expect(getProduction).not.toHaveBeenCalled();
    expect(deleteProduction.mock.calls).toEqual([['p1'], ['p2']]);
    expect(deleteShort.mock.calls).toEqual([['s2']]);
  });

  it('keeps the dialog open (false) when the production could not be deleted, and never touches the short', async () => {
    const deleteProduction = vi.fn<ApiClient['deleteProduction']>().mockRejectedValue(new ApiError(ERROR.FORBIDDEN, 'not yours', 403));
    const deleteShort = vi.fn<ApiClient['deleteShort']>();
    const services = fakeServices({ api: fakeApi({ deleteProduction, deleteShort }) });
    const { probe, Probe } = oneProbe(useDeleteProduction);
    view = await mount(<Probe />, services);

    let isDone: boolean | undefined;
    await act(async () => {
      isDone = await probe.current?.remove({ productionId: 'p1', alsoShort: true, shortId: 's9' });
    });

    expect(isDone).toBe(false);
    expect(deleteShort).not.toHaveBeenCalled();
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not delete the production']);
  });
});

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
