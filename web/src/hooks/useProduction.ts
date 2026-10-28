// One production: polled while its plan, coverage or drawing run is in flight, with the run's
// live step from SSE, and the actions of its page (recheck coverage, retry a stopped plan, cut
// the story, redraw a shot's board from footage, new key art, use the art as a cover).
import { useCallback, useEffect, useState } from 'react';
import { isLastStudioStep } from '../services/events/studio-steps';
import type { ProductionDetail, ShortProduction, StudioStepEvent } from '../services/api/types';
import { useInFlightKeys } from './useInFlightKeys';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Poll interval while a run is in flight, ms (new storyboard frames show as they land). */
export const PRODUCTION_POLL_MS = 2500;

const isRunning = (detail: ProductionDetail) =>
  detail.busy || detail.production.status === 'planning' || detail.production.art_drawing;

/** The page's data, live step and actions. */
export interface ProductionHandle {
  state: Polled<ProductionDetail>;
  /** The run's latest step, while one is in flight. */
  progress: StudioStepEvent | null;
  refresh: () => void;
  /** Rechecks coverage now (the server runs it at most once a minute). */
  recheck: () => Promise<void>;
  /** Resumes a stopped plan. */
  retry: () => Promise<void>;
  /** Cuts the story short; resolves its id, or null on failure. */
  cut: () => Promise<string | null>;
  isCutting: boolean;
  /** Redraws a covered shot's storyboard from its moment's hook frame. */
  redrawBoard: (shotId: string) => Promise<void>;
  /** Shots whose board redraw the user asked for and that have not settled. */
  redrawingBoards: ReadonlySet<string>;
}

/**
 * Loads one production by id.
 * @param productionId - Route id.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The handle.
 */
export function useProduction(productionId: string, intervalMs: number = PRODUCTION_POLL_MS): ProductionHandle {
  const { api, productionSteps, toasts } = useServices();
  const { keys: redrawingBoards, add: markBoard, settle } = useInFlightKeys();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const requestedAt = Date.now();
      const detail = await api.getProduction(productionId, signal);
      settle(detail.busy, requestedAt);
      return detail;
    },
    [api, productionId, settle],
  );
  const { state, refresh } = usePolled(load, { intervalMs, keepPolling: isRunning });
  const [live, setLive] = useState<{ id: string; event: StudioStepEvent | null }>({ id: productionId, event: null });
  const [isCutting, setCutting] = useState(false);
  const running = state.status !== 'ready' || isRunning(state.data);

  useEffect(() => {
    if (!running) return undefined;
    return productionSteps(productionId, (event) => {
      setLive({ id: productionId, event });
      if (isLastStudioStep(event)) refresh();
    });
  }, [productionSteps, productionId, running, refresh]);

  const start = useCallback(
    async (run: () => Promise<unknown>, failure: string) => {
      try {
        await run();
        refresh();
      } catch (error) {
        toasts.error(failure, error);
      }
    },
    [refresh, toasts],
  );
  const recheck = useCallback(
    () => start(() => api.recheckCoverage(productionId), 'Could not check coverage'),
    [api, productionId, start],
  );
  const retry = useCallback(
    () => start(() => api.retryProduction(productionId), 'Could not restart planning'),
    [api, productionId, start],
  );
  const cut = useCallback(async () => {
    setCutting(true);
    try {
      return (await api.cutProduction(productionId)).short_id;
    } catch (error) {
      toasts.error('Could not cut the story', error);
      return null;
    } finally {
      setCutting(false);
    }
  }, [api, productionId, toasts]);

  const redrawBoard = useCallback(
    async (shotId: string) => {
      try {
        await api.redrawShotBoard(productionId, shotId);
        markBoard(shotId);
        refresh();
      } catch (error) {
        toasts.error('Could not redraw the storyboard', error);
      }
    },
    [api, productionId, markBoard, refresh, toasts],
  );

  const progress = running && live.id === productionId ? live.event : null;
  return { state, progress, refresh, recheck, retry, cut, isCutting, redrawBoard, redrawingBoards };
}

/** A short's production, or none when the short was not cut from one. */
export type ShortProductionState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; production: ShortProduction };

/**
 * The production a story short was cut from. A 404 (any other short) and a failed load both
 * read as none, so the short page stays as it always was.
 * @param shortId - The short.
 * @returns The state.
 */
export function useShortProduction(shortId: string): ShortProductionState {
  const { api } = useServices();
  const [state, setState] = useState<{ id: string; value: ShortProductionState }>({
    id: shortId,
    value: { status: 'loading' },
  });
  useEffect(() => {
    const controller = new AbortController();
    api.getShortProduction(shortId, controller.signal).then(
      (production) => {
        setState({ id: shortId, value: { status: 'ready', production } });
      },
      () => {
        if (!controller.signal.aborted) setState({ id: shortId, value: { status: 'none' } });
      },
    );
    return () => {
      controller.abort();
    };
  }, [api, shortId]);
  return state.id === shortId ? state.value : { status: 'loading' };
}
