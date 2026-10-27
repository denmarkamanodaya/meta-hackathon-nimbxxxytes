// Editor hooks: the Search hand-off, creating a short, the polled short with live agent steps,
// and the final render with download / share.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { isShortWorking, mergeSteps } from '../core/agent-trail';
import { readEditorHandoff } from '../core/selection';
import { parseResult } from '../services/api/parse-search';
import type {
  AgentStep,
  CreateShortRequest,
  SearchResult,
  ShortDetail,
} from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Short poll interval in ms while the agent or a render runs. */
export const SHORT_POLL_MS = 2500;

/**
 * Reads the moments picked on Search from router state. Rows that fail to parse are dropped;
 * the ids alone still work (the server has the segments).
 * @returns Picked ids in pick order and the result rows that came with them.
 */
export function useEditorHandoff(): { segmentIds: string[]; moments: SearchResult[] } {
  const state: unknown = useLocation().state;
  return useMemo(() => {
    const segmentIds = readEditorHandoff(state);
    const raw =
      typeof state === 'object' && state !== null && 'moments' in state && Array.isArray(state.moments)
        ? (state.moments as unknown[])
        : [];
    const moments = raw.map(parseResult).filter((row): row is SearchResult => row !== null);
    return { segmentIds, moments };
  }, [state]);
}

/** State of the "Make it" request. */
export type CreateState = { status: 'idle' | 'creating' } | { status: 'error'; message: string };

/**
 * Starts the editing agent.
 * @returns The request state and `create`, which resolves the new short id or null on failure.
 */
export function useCreateShort(): {
  state: CreateState;
  create: (request: CreateShortRequest) => Promise<string | null>;
} {
  const { api, toasts } = useServices();
  const [state, setState] = useState<CreateState>({ status: 'idle' });
  const create = useCallback(
    async (request: CreateShortRequest) => {
      setState({ status: 'creating' });
      try {
        const { short_id } = await api.createShort(request);
        setState({ status: 'idle' });
        return short_id;
      } catch (error) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Could not start' });
        toasts.error('Could not start the editor', error);
        return null;
      }
    },
    [api, toasts],
  );
  return { state, create };
}

const keepPollingShort = (detail: ShortDetail) => isShortWorking(detail.short.status);

/**
 * Polls one short while it is working and merges live agent steps from SSE into its log.
 * @param shortId - Route id.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The polled short, the merged step log, and `refresh` (restarts polling).
 */
export function useShort(
  shortId: string,
  intervalMs: number = SHORT_POLL_MS,
): { state: Polled<ShortDetail>; steps: AgentStep[]; refresh: () => void } {
  const { api, shortSteps } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getShort(shortId, signal), [api, shortId]);
  const { state, refresh } = usePolled(load, { intervalMs, keepPolling: keepPollingShort });
  const [live, setLive] = useState<{ shortId: string; steps: AgentStep[] }>({ shortId, steps: [] });
  const isWorking = state.status !== 'ready' || isShortWorking(state.data.short.status);

  useEffect(() => {
    if (!isWorking) return undefined;
    return shortSteps(shortId, (step) => {
      setLive((current) => ({
        shortId,
        steps: current.shortId === shortId ? [...current.steps, step] : [step],
      }));
      if (step.kind === 'final') refresh();
    });
  }, [shortSteps, shortId, isWorking, refresh]);

  const polled = state.status === 'ready' ? state.data.steps : null;
  const steps = useMemo(
    () => mergeSteps(polled ?? [], live.shortId === shortId ? live.steps : []),
    [polled, live, shortId],
  );
  return { state, steps, refresh };
}

/** Where the final render request is. */
export type FinalState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'requested' }
  | { status: 'error'; message: string };

/** The final render's request state and trigger. */
export interface FinalRender {
  state: FinalState;
  /** True once a render was asked for and until the page reloads (the URL then decides). */
  isPending: boolean;
  render: (versionN: number) => Promise<void>;
}

/**
 * Requests the final render of a version, then restarts polling so its URL arrives.
 * @param shortId - The short.
 * @param refresh - Restarts polling of the short.
 * @returns The request state, `isPending` and `render`.
 */
export function useFinalRender(shortId: string, refresh: () => void): FinalRender {
  const { api, toasts } = useServices();
  const [state, setState] = useState<FinalState>({ status: 'idle' });
  const render = useCallback(
    async (versionN: number) => {
      setState({ status: 'requesting' });
      try {
        await api.renderShort(shortId, versionN);
        setState({ status: 'requested' });
        refresh();
      } catch (error) {
        setState({ status: 'error', message: error instanceof Error ? error.message : 'Render failed' });
        toasts.error('Could not start the final render', error);
      }
    },
    [api, shortId, refresh, toasts],
  );
  return { state, isPending: state.status === 'requesting' || state.status === 'requested', render };
}

/** Result of a share attempt, for the UI. */
export type ShareState = 'idle' | 'sharing' | 'shared' | 'unsupported' | 'error';

/**
 * Shares the final MP4 through the system share sheet.
 * @returns The share state and `share`.
 */
export function useShareVideo(): {
  state: ShareState;
  share: (url: string, filename: string, title: string) => Promise<void>;
} {
  const { shareVideo, toasts } = useServices();
  const [state, setState] = useState<ShareState>('idle');
  const share = useCallback(
    async (url: string, filename: string, title: string) => {
      setState('sharing');
      try {
        const outcome = await shareVideo(url, filename, title);
        setState(outcome === 'cancelled' ? 'idle' : outcome);
      } catch (error) {
        setState('error'); // Recovers: the Download link stays available.
        toasts.error('Could not share the video', error);
      }
    },
    [shareVideo, toasts],
  );
  return { state, share };
}
