// A short's publish pack: its exports, polled while a publish or cover run or a render is in
// flight, the run's live step from SSE, and the Publish screen's edits (caption, hashtags,
// cover pick, cover title, more covers in a style, redraw a cover with words).
import { useCallback, useEffect, useState } from 'react';
import { isLastStudioStep } from '../services/events/studio-steps';
import type {
  CoverTitle,
  EditExportRequest,
  ExportsResponse,
  CoverChipStyle,
  CutoutBackground,
  Platform,
  StudioStepEvent,
} from '../services/api/types';
import { useInFlightKeys } from './useInFlightKeys';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/**
 * Copies a post's text to the clipboard and says whether it worked.
 * @returns `copy(text)`.
 */
export function useCopyCaption(): (text: string) => Promise<void> {
  const { copyText, toasts } = useServices();
  return useCallback(
    async (text: string) => {
      const ok = await copyText(text);
      if (ok) toasts.info('Caption copied', 'Paste it when you post.');
      else toasts.info('Could not copy', 'Select the caption and copy it by hand.');
    },
    [copyText, toasts],
  );
}

/** Poll interval while anything runs, ms. */
export const EXPORTS_POLL_MS = 3000;

/**
 * Whether the pack is still changing: a run or render in flight, or a ready export whose titled
 * cover is still being baked (the API sends no event for that, so polling finds it).
 * @param answer - The latest pack.
 * @returns True while polling should go on.
 */
export const isExportsRunning = (answer: ExportsResponse) =>
  answer.busy ||
  answer.exports.some(
    (e) =>
      e.status === 'queued' ||
      e.status === 'rendering' ||
      (e.status === 'ready' && e.covers.length > 0 && e.download_cover_url === null),
  );

/** The pack and its actions. */
export interface ExportsHandle {
  state: Polled<ExportsResponse>;
  /** The run's latest step while one is in flight. */
  progress: StudioStepEvent | null;
  /** Starts captions, covers and renders for the platforms; resolves true when it started. */
  start: (platforms: Platform[]) => Promise<boolean>;
  /** Saves one platform's edit; resolves true on success (a toast says why not). */
  edit: (platform: Platform, change: EditExportRequest) => Promise<boolean>;
  /** Asks for 3 more covers for one platform, in a style when given; `cutout` asks for one cutout cover over `background`. */
  moreCovers: (platform: Platform, style?: CoverChipStyle, background?: CutoutBackground) => Promise<void>;
  /** Saves the cover title; resolves true on success. */
  saveTitle: (platform: Platform, title: CoverTitle) => Promise<boolean>;
  /** Asks for one new cover drawn from cover `coverIndex` (0-based) and the words; resolves true when it started. */
  redraw: (platform: Platform, coverIndex: number, instruction: string) => Promise<boolean>;
  /** Platforms with a redraw in flight (their new cover is not drawn yet). */
  redrawing: ReadonlySet<string>;
  refresh: () => void;
}

/**
 * Loads a short's exports.
 * @param shortId - The short.
 * @param intervalMs - Poll interval; tests shorten it.
 * @returns The handle.
 */
export function useExports(shortId: string, intervalMs: number = EXPORTS_POLL_MS): ExportsHandle {
  const { api, exportSteps, toasts } = useServices();
  const { keys: redrawing, add: markRedraw, settle } = useInFlightKeys();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const requestedAt = Date.now();
      const answer = await api.listExports(shortId, signal);
      settle(answer.busy, requestedAt);
      return answer;
    },
    [api, shortId, settle],
  );
  const { state, refresh } = usePolled(load, { intervalMs, keepPolling: isExportsRunning });
  const [live, setLive] = useState<{ id: string; event: StudioStepEvent | null }>({ id: shortId, event: null });
  const busy = state.status === 'ready' && state.data.busy;

  useEffect(() => {
    if (!busy) return undefined;
    return exportSteps(shortId, (event) => {
      setLive({ id: shortId, event });
      if (isLastStudioStep(event)) refresh();
    });
  }, [exportSteps, shortId, busy, refresh]);

  const start = useCallback(
    async (platforms: Platform[]) => {
      try {
        await api.createExports(shortId, platforms);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not start publishing', error);
        return false;
      }
    },
    [api, shortId, refresh, toasts],
  );

  const edit = useCallback(
    async (platform: Platform, change: EditExportRequest) => {
      try {
        await api.editExport(shortId, platform, change);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not save the change', error);
        return false;
      }
    },
    [api, shortId, refresh, toasts],
  );

  const moreCovers = useCallback(
    async (platform: Platform, style?: CoverChipStyle, background?: CutoutBackground) => {
      try {
        await (background === undefined
          ? api.moreCovers(shortId, platform, style)
          : api.moreCovers(shortId, platform, style, background));
        refresh();
      } catch (error) {
        toasts.error('Could not make more covers', error);
      }
    },
    [api, shortId, refresh, toasts],
  );

  const saveTitle = useCallback(
    (platform: Platform, title: CoverTitle) => edit(platform, { cover_title: title }),
    [edit],
  );

  const redraw = useCallback(
    async (platform: Platform, coverIndex: number, instruction: string) => {
      try {
        await api.redrawCover(shortId, platform, coverIndex, instruction.trim());
        markRedraw(platform);
        refresh();
        return true;
      } catch (error) {
        toasts.error('Could not redraw the cover', error);
        return false;
      }
    },
    [api, shortId, markRedraw, refresh, toasts],
  );

  const progress = busy && live.id === shortId ? live.event : null;
  return { state, progress, start, edit, moreCovers, saveTitle, redraw, redrawing, refresh };
}
