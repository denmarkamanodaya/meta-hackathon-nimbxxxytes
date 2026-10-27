// Productions list hooks: the list itself, starting a new production, and which Studio list
// (Shorts or Productions) is shown, remembered for the session.
import { useCallback, useState } from 'react';
import type { CreateProductionRequest, ProductionListItem } from '../services/api/types';
import type { StudioView } from '../services/studio-view';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Productions list poll interval, ms (a plan in flight changes its row). */
export const PRODUCTIONS_POLL_MS = 5000;

/**
 * Every production, newest first.
 * @returns The polled list and `refresh`.
 */
export function useProductions(): { state: Polled<ProductionListItem[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listProductions(signal), [api]);
  return usePolled(load, { intervalMs: PRODUCTIONS_POLL_MS });
}

/**
 * Starts planning a production; a failure raises a toast.
 * @returns `create`, resolving the new production id or null, and whether it runs.
 */
export function useCreateProduction(): {
  create: (request: CreateProductionRequest) => Promise<string | null>;
  isCreating: boolean;
} {
  const { api, toasts } = useServices();
  const [isCreating, setCreating] = useState(false);
  const create = useCallback(
    async (request: CreateProductionRequest) => {
      setCreating(true);
      try {
        return (await api.createProduction(request)).production_id;
      } catch (error) {
        toasts.error('Could not start planning', error);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [api, toasts],
  );
  return { create, isCreating };
}

/**
 * The Studio's list (Shorts by default), remembered for the session.
 * @returns The view and `setView`.
 */
export function useStudioView(): { view: StudioView; setView: (view: StudioView) => void } {
  const { studioView } = useServices();
  const [view, setState] = useState<StudioView>(() => studioView.read());
  const setView = useCallback(
    (next: StudioView) => {
      studioView.write(next);
      setState(next);
    },
    [studioView],
  );
  return { view, setView };
}
