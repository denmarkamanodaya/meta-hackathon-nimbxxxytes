// Hooks for the Mist summary screens: the library's storage card, the People overview (with
// naming, hiding and unhiding faces, face groups and the face-matching setting), and the Shorts list.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { capView, type CapView } from '../core/storage';
import type { PeopleOverview, Settings, ShortListItem, StorageSummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

const once = () => false;

/** Storage poll interval while the library is open, ms (uploads change it). */
export const STORAGE_POLL_MS = 15_000;

/**
 * The storage card's numbers.
 * @returns The polled summary.
 */
export function useStorage(): Polled<StorageSummary> {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getStorage(signal), [api]);
  return usePolled(load, { intervalMs: STORAGE_POLL_MS }).state;
}

/**
 * The account's storage cap in words ("44.2 GB of 250 GB", the warning, the full block).
 * @returns The view, or null until storage loads (or when it cannot be read).
 */
export function useStorageCap(): CapView | null {
  const state = useStorage();
  return state.status === 'ready' ? capView(state.data) : null;
}

/**
 * The People overview, loaded once; `refresh` reloads it after a name, hide or unhide.
 * @returns The polled overview and `refresh`.
 */
export function usePeopleOverview(): { state: Polled<PeopleOverview>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getPeopleOverview(signal), [api]);
  return usePolled(load, { intervalMs: 60_000, keepPolling: once });
}

/**
 * Hides or unhides a face, then reloads the overview; failures raise a toast.
 * @param refresh - Reloads the overview.
 * @returns `setHidden(trackId, hidden)`, resolving true on success.
 */
export function useTrackVisibility(refresh: () => void): (trackId: string, hidden: boolean) => Promise<boolean> {
  const { api, toasts } = useServices();
  return useCallback(
    async (trackId: string, hidden: boolean) => {
      try {
        await api.updateTrack(trackId, { hidden });
        refresh();
        return true;
      } catch (error) {
        toasts.error(hidden ? 'Could not hide this face' : 'Could not unhide this face', error);
        return false;
      }
    },
    [api, toasts, refresh],
  );
}

/** Shorts list poll interval, ms (a running short changes status). */
export const SHORTS_POLL_MS = 5000;

/**
 * Every short, newest first.
 * @returns The polled list and `refresh`.
 */
export function useShortsList(): { state: Polled<ShortListItem[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listShorts(signal), [api]);
  return usePolled(load, { intervalMs: SHORTS_POLL_MS });
}

/**
 * Names every face on a People card in one call (`POST /tracks/name`), then reloads.
 * @param refresh - Reloads the overview.
 * @returns `nameAll(trackIds, name)`, resolving true on success.
 */
export function useNameFaces(refresh: () => void): (trackIds: string[], name: string) => Promise<boolean> {
  const { api, toasts } = useServices();
  return useCallback(
    async (trackIds: string[], name: string) => {
      try {
        await api.nameTracks(trackIds, name);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not save the name', error);
        return false;
      }
    },
    [api, toasts, refresh],
  );
}

/**
 * Hides every face on a People card (one `PUT /tracks/{id}` each), then reloads once.
 * @param refresh - Reloads the overview.
 * @returns `hideAll(trackIds)`, resolving true when every face was hidden.
 */
export function useHideFaces(refresh: () => void): (trackIds: string[]) => Promise<boolean> {
  const { api, toasts } = useServices();
  return useCallback(
    async (trackIds: string[]) => {
      const results = await Promise.allSettled(trackIds.map((id) => api.updateTrack(id, { hidden: true })));
      refresh();
      const failed = results.find((r) => r.status === 'rejected');
      if (failed === undefined) return true;
      toasts.error('Could not hide every face', failed.reason);
      return false;
    },
    [api, toasts, refresh],
  );
}

/**
 * Face-match suggestions the owner said "Not them" to this session.
 * @returns The dismissed card keys and `dismiss`.
 */
export function useDismissedMatches(): { dismissed: ReadonlySet<string>; dismiss: (key: string) => void } {
  const { dismissedMatches } = useServices();
  const dismissed = useSyncExternalStore(dismissedMatches.subscribe, dismissedMatches.getSnapshot);
  return { dismissed, dismiss: dismissedMatches.dismiss };
}

/** The account settings as the Settings screens see them. */
export type SettingsState =
  | { status: 'loading' }
  | { status: 'ready'; faceMatching: boolean; blurObjects: boolean; isSaving: boolean }
  | { status: 'error' };

/** The settings and their switches. */
export interface SettingsHandle {
  state: SettingsState;
  setFaceMatching: (on: boolean) => Promise<void>;
  /** "Also blur screens and number plates". */
  setBlurObjects: (on: boolean) => Promise<void>;
}

/**
 * Reads the settings and saves a switch; `PUT /settings` always carries every setting, so a change
 * to one sends the others as they are. A failed save toasts and keeps the previous value.
 * @returns The state and the switches.
 */
export function useSettings(): SettingsHandle {
  const { api, toasts } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getSettings(signal), [api]);
  const { state: loaded } = usePolled(load, { intervalMs: 60_000, keepPolling: once });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [isSaving, setSaving] = useState(false);
  const current = saved ?? (loaded.status === 'ready' ? loaded.data : null);
  const save = useCallback(
    async (change: Partial<Settings>, failure: string) => {
      if (current === null) return;
      setSaving(true);
      try {
        setSaved(await api.updateSettings({ ...current, ...change }));
      } catch (error) {
        toasts.error(failure, error);
      } finally {
        setSaving(false);
      }
    },
    [api, toasts, current],
  );
  const setFaceMatching = useCallback(
    (on: boolean) => save({ face_matching: on }, on ? 'Could not turn on face matching' : 'Could not turn off face matching'),
    [save],
  );
  const setBlurObjects = useCallback(
    (on: boolean) => save({ blur_objects: on }, 'Could not save the screens and plates setting'),
    [save],
  );
  const handle = { setFaceMatching, setBlurObjects };
  if (loaded.status === 'loading') return { state: { status: 'loading' }, ...handle };
  if (current === null) return { state: { status: 'error' }, ...handle };
  return {
    state: { status: 'ready', faceMatching: current.face_matching, blurObjects: current.blur_objects, isSaving },
    ...handle,
  };
}
