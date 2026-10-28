import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import productions from '../test-support/fixtures/productions.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { ApiError, type ApiClient } from '../services/api/client';
import { parseProductionDetail } from '../services/api/parse-studio';
import { ERROR, type ProductionDetail } from '../services/api/types';
import { useProduction, type ProductionHandle } from './useProduction';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const detail = parseProductionDetail(productions[0]);
if (detail === null) throw new Error('productions.json parses');
const idle: ProductionDetail = { ...detail, busy: false, production: { ...detail.production, status: 'shooting' } };
const busy: ProductionDetail = { ...idle, busy: true };

const seen: { handle: ProductionHandle | null } = { handle: null };
function Probe() {
  const handle = useProduction('pr1', 10);
  useEffect(() => {
    seen.handle = handle;
  });
  return null;
}

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('useProduction: redraw a board from footage', () => {
  it('asks for the shot, keeps it drawing while the run is busy, and lets go once a later answer is idle', async () => {
    // The server is busy from the redraw until the test says it finished. Answers follow that
    // state, not the call count: while busy the page polls every 10 ms on real timers, so how many
    // calls happen between two steps of the test is not fixed.
    const server = { busy: false };
    const getProduction = vi.fn<ApiClient['getProduction']>(() => Promise.resolve(server.busy ? busy : idle));
    const redrawShotBoard = vi.fn<ApiClient['redrawShotBoard']>(() => {
      server.busy = true;
      return Promise.resolve({ started: true });
    });
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getProduction, redrawShotBoard }) }));
    await settle();

    await act(async () => {
      await seen.handle?.redrawBoard('pr_morning_s1');
    });
    await settle();

    expect(redrawShotBoard).toHaveBeenCalledWith('pr1', 'pr_morning_s1');
    expect(seen.handle?.state).toMatchObject({ status: 'ready', data: { busy: true } });
    expect([...(seen.handle?.redrawingBoards ?? [])]).toEqual(['pr_morning_s1']);

    server.busy = false;
    await act(async () => {
      seen.handle?.refresh();
      await Promise.resolve();
    });
    await settle();
    expect(seen.handle?.redrawingBoards.size).toBe(0);
  });

  it('says why when the server refuses (a shot that is not covered)', async () => {
    const getProduction = vi.fn<ApiClient['getProduction']>().mockResolvedValue(idle);
    const redrawShotBoard = vi.fn<ApiClient['redrawShotBoard']>().mockRejectedValue(new ApiError(ERROR.NOT_FOUND, 'not covered', 400));
    const services = fakeServices({ api: fakeApi({ getProduction, redrawShotBoard }) });
    view = await mount(<Probe />, services);
    await settle();

    await act(async () => {
      await seen.handle?.redrawBoard('pr_morning_s2');
    });

    expect(seen.handle?.redrawingBoards.size).toBe(0);
    expect(services.toasts.getSnapshot().map((t) => t.title)).toEqual(['Could not redraw the storyboard']);
  });
});
