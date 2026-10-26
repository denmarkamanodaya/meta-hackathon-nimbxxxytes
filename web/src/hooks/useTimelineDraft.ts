// The user's edits to one version's timeline (reorder, drop, trim), kept locally until saved as
// a new version with PUT /shorts/{id}/timeline.
import { useCallback, useState } from 'react';
import { dropClip, moveClip, trimClip } from '../core/timeline-edit';
import type { ShortSegment, ShortVersion, TimelineClip } from '../services/api/types';
import { useServices } from './services-context';

/** State of the save request. */
export type SaveState = { status: 'idle' | 'saving' } | { status: 'error'; message: string };

/** What `useTimelineDraft` hands the editor. */
export interface TimelineDraft {
  clips: TimelineClip[];
  isDirty: boolean;
  move: (from: number, to: number) => void;
  drop: (index: number) => void;
  trim: (index: number, edge: 'in' | 'out', seconds: number) => void;
  reset: () => void;
  /** Saves the draft; resolves the new version number, or null on failure. */
  save: () => Promise<number | null>;
  saveState: SaveState;
}

/**
 * Local edits over `version`'s clips. Switching to another version starts a fresh draft.
 * @param shortId - The short.
 * @param version - The version being edited.
 * @param segments - Candidate segments (trim bounds).
 * @returns See `TimelineDraft`.
 */
export function useTimelineDraft(
  shortId: string,
  version: ShortVersion,
  segments: readonly ShortSegment[],
): TimelineDraft {
  const { api } = useServices();
  const [draft, setDraft] = useState<{ n: number; clips: TimelineClip[] | null }>({
    n: version.n,
    clips: null,
  });
  const [saveState, setSaveState] = useState<SaveState>({ status: 'idle' });
  const edited = draft.n === version.n ? draft.clips : null;
  const clips = edited ?? version.timeline.clips;

  const update = useCallback(
    (change: (current: TimelineClip[]) => TimelineClip[]) => {
      setDraft((current) => {
        const base = current.n === version.n && current.clips !== null ? current.clips : version.timeline.clips;
        return { n: version.n, clips: change(base) };
      });
    },
    [version],
  );

  const save = useCallback(async () => {
    setSaveState({ status: 'saving' });
    try {
      const { version: saved } = await api.saveTimeline(shortId, {
        ...version.timeline,
        clips,
        revision: null,
      });
      setSaveState({ status: 'idle' });
      setDraft({ n: version.n, clips: null });
      return saved;
    } catch (error) {
      setSaveState({ status: 'error', message: error instanceof Error ? error.message : 'Save failed' });
      return null;
    }
  }, [api, shortId, version, clips]);

  return {
    clips,
    isDirty: edited !== null,
    move: (from, to) => {
      update((current) => moveClip(current, from, to));
    },
    drop: (index) => {
      update((current) => dropClip(current, index));
    },
    trim: (index, edge, seconds) => {
      update((current) =>
        current.map((clip, i) => {
          const segment = segments.find((s) => s.segment_id === clip.segment_id);
          return i === index && segment !== undefined ? trimClip(clip, edge, seconds, segment) : clip;
        }),
      );
    },
    reset: () => {
      setDraft({ n: version.n, clips: null });
    },
    save,
    saveState,
  };
}
