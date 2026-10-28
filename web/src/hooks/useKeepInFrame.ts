// Keep subject in frame on a Short page (board V19): the finish switch (saved through the existing
// finish update), the short's subject tracking (started on open when the switch is on and nothing
// ran), and the Centre crop / Follows subject preview choice.
import { useMemo, useState } from 'react';
import { withoutCropPath } from '../core/reframe';
import type { ReframeResponse, ShortFinish, TimelineClip } from '../services/api/types';
import { useFinish } from './useFinish';
import { useReframe } from './useReframe';

/** What the V19 controls read and do. */
export interface KeepInFrame {
  finish: ShortFinish | null;
  /** The tracking answer; null while it loads or failed to load. */
  reframe: ReframeResponse | null;
  setKeepSubject: (on: boolean) => void;
  setBlurFaces: (on: boolean) => void;
  isSaving: boolean;
  /** The preview follows the subject (true) or shows a centre crop. */
  isFollow: boolean;
  setFollow: (follow: boolean) => void;
}

/**
 * The shots' subjects as one key, so a changed subject can start a new track.
 * @param clips - The shown shots.
 * @returns The key.
 */
export const subjectsKey = (clips: readonly TimelineClip[]): string => clips.map((c) => `${c.segment_id}=${c.subject ?? ''}`).join('|');

/**
 * Keep subject in frame for one short.
 * @param shortId - The short.
 * @param clips - The shown draft's shots.
 * @returns The handle.
 */
export function useKeepInFrame(shortId: string, clips: readonly TimelineClip[]): KeepInFrame {
  const { finish, update, isSaving } = useFinish(shortId);
  const key = useMemo(() => subjectsKey(clips), [clips]);
  const { state } = useReframe(shortId, finish?.keep_subject ?? null, key);
  const [isFollow, setFollow] = useState(true);
  return {
    finish,
    reframe: state.status === 'ready' ? state.data : null,
    setKeepSubject: (on) => {
      void update({ keep_subject: on });
    },
    setBlurFaces: (on) => {
      void update({ blur_bystanders: on });
    },
    isSaving,
    isFollow,
    setFollow,
  };
}

/**
 * The Player's props for the chosen preview: as they are (Follows subject) or without any crop
 * path (Centre crop). Memoised so the Player keeps its place when nothing changed.
 * @param props - The Player props, or null.
 * @param isFollow - The preview choice.
 * @returns The props to play.
 */
export function usePreviewProps<P extends { clips: readonly object[] }>(props: P | null, isFollow: boolean): P | null {
  return useMemo(() => (props === null || isFollow ? props : withoutCropPath(props)), [props, isFollow]);
}
