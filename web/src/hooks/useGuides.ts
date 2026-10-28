// MyWay guide hooks: the list, one guide (polled while it is being made), Make a guide from a
// clip, editing a step's text, and deleting a guide. Each failure raises a toast.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { isGuideBusy } from '../core/guides';
import type { Guide, GuideStepEdit, GuideSummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Guides list poll interval, ms (a guide being made changes its row). */
export const GUIDES_POLL_MS = 5000;
/** One guide's poll interval while it is being made, ms (a guide takes about a minute). */
export const GUIDE_POLL_MS = 2000;

/** The route of a guide. */
export const guidePath = (guideId: string): string => `/guides/${encodeURIComponent(guideId)}`;

/** The route of one step in the phone step view. */
export const guideStepPath = (guideId: string, n: number): string => `${guidePath(guideId)}/step/${String(n)}`;

/**
 * Every guide, newest first as the API sends them.
 * @returns The polled list and `refresh`.
 */
export function useGuides(): { state: Polled<GuideSummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listGuides(signal), [api]);
  return usePolled(load, { intervalMs: GUIDES_POLL_MS });
}

const keepPollingGuide = (guide: Guide) => isGuideBusy(guide.status);

/**
 * One guide, polled until it is ready, failed or refused.
 * @param guideId - The guide.
 * @returns The polled guide and `refresh`.
 */
export function useGuide(guideId: string): { state: Polled<Guide>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getGuide(guideId, signal), [api, guideId]);
  return usePolled(load, { intervalMs: GUIDE_POLL_MS, keepPolling: keepPollingGuide });
}

/**
 * Make a guide: starts it from the clip (the same guide on a second tap) and opens it.
 * @returns `start` and whether a start is in flight.
 */
export function useStartGuide(): { start: (clipId: string) => void; isStarting: boolean } {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isStarting, setStarting] = useState(false);
  const start = useCallback(
    (clipId: string) => {
      setStarting(true);
      api
        .startGuide(clipId)
        .then(
          (answer) => {
            void navigate(guidePath(answer.guide_id));
          },
          (error: unknown) => {
            toasts.error('Could not start the guide', error);
          },
        )
        .finally(() => {
          setStarting(false);
        });
    },
    [api, navigate, toasts],
  );
  return { start, isStarting };
}

/** Saving a step's new text. */
export interface EditGuideStep {
  /** Saves the edit; resolves true on success (the step's voice is remade by the server). */
  save: (n: number, edit: GuideStepEdit) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * Edit text: PATCHes the step, then reloads the guide.
 * @param guideId - The guide.
 * @param onSaved - Called after a save succeeds (reload the guide).
 * @returns `save` and whether it runs.
 */
export function useEditGuideStep(guideId: string, onSaved: () => void): EditGuideStep {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);
  const save = useCallback(
    async (n: number, edit: GuideStepEdit) => {
      setSaving(true);
      try {
        await api.editGuideStep(guideId, n, edit);
        onSaved();
        return true;
      } catch (error) {
        toasts.error('Could not save the step', error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, guideId, onSaved, toasts],
  );
  return { save, isSaving };
}

/** Deleting a guide. */
export interface DeleteGuide {
  /** Deletes it and opens the Guides list; resolves false (with a toast) when it failed. */
  remove: (guideId: string) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Delete guide: removes the guide and leaves for the Guides list, replacing the guide in history.
 * @returns `remove` and whether it runs.
 */
export function useDeleteGuide(): DeleteGuide {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const remove = useCallback(
    async (guideId: string) => {
      setDeleting(true);
      try {
        await api.deleteGuide(guideId);
        void navigate('/guides', { replace: true });
        return true;
      } catch (error) {
        toasts.error('Could not delete the guide', error);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [api, navigate, toasts],
  );
  return { remove, isDeleting };
}
