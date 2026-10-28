// Pick mode on a clip player, shared by Find this and Cut out (boards V18, V22): a button turns it
// on, the next click on the picture picks the object (Esc cancels), the call runs under a veil,
// then Find this shows what it found and Cut out opens its dialog. A failed call (the server gives
// SAM up to 50 s, then answers MODEL_UNAVAILABLE) shows why in the veil, with Try again.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CUTOUT_COPY } from '../core/copy';
import { failureText } from '../core/find-this';
import type { CutoutResponse, FindResponse, FramePoint } from '../services/api/types';
import { useServices } from './services-context';

/** What the pick is for. */
export type PickPurpose = 'find' | 'cutout';

/** Where pick mode is. */
export type PickState =
  | { phase: 'off' }
  | { phase: 'picking'; purpose: PickPurpose }
  | { phase: 'working'; purpose: PickPurpose; point: FramePoint }
  | { phase: 'failed'; purpose: PickPurpose; point: FramePoint; message: string }
  | { phase: 'found'; point: FramePoint; found: FindResponse }
  | { phase: 'cut'; point: FramePoint; cutout: CutoutResponse };

/** Pick mode and its actions. */
export interface ObjectPick {
  state: PickState;
  /** Find this or Cut out pressed: starts picking, or turns that mode off when it is on. */
  toggle: (purpose: PickPurpose) => void;
  /** A click on the picture while picking. */
  pick: (point: FramePoint) => void;
  /** Esc, or closing the Cut out dialog. */
  cancel: () => void;
  /** Try again after a failed call: the same point, the same purpose. */
  retry: () => void;
}

/**
 * Copy in the Cut out dialog: the PNG on the clipboard where the browser allows it, else its link;
 * a toast says which.
 * @returns The copy action.
 */
export function useCopyCutout(): (url: string) => Promise<void> {
  const { copyImage, toasts } = useServices();
  return useCallback(
    async (url: string) => {
      const copied = await copyImage(url);
      if (copied === 'image') toasts.info(CUTOUT_COPY.copied, 'Paste it anywhere that takes images.');
      else if (copied === 'link') toasts.info(CUTOUT_COPY.copiedLink, 'This browser copies the link to the PNG.');
      else toasts.info('Could not copy', 'Use Download PNG instead.');
    },
    [copyImage, toasts],
  );
}

/**
 * The purpose a state belongs to, or null when off.
 * @param state - The state.
 * @returns `find`, `cutout` or null.
 */
export function purposeOf(state: PickState): PickPurpose | null {
  if (state.phase === 'off') return null;
  if (state.phase === 'found') return 'find';
  if (state.phase === 'cut') return 'cutout';
  return state.purpose;
}

/**
 * Pick mode for one clip.
 * @param clipId - The clip on the player.
 * @returns The state and actions.
 */
export function useObjectPick(clipId: string): ObjectPick {
  const { api } = useServices();
  const [state, setState] = useState<PickState>({ phase: 'off' });
  // Each call gets a number; an answer for an older one (cancelled, or the page moved on) is dropped.
  const call = useRef(0);

  const cancel = useCallback(() => {
    call.current += 1;
    setState({ phase: 'off' });
  }, []);

  const toggle = useCallback((purpose: PickPurpose) => {
    call.current += 1;
    setState((current) => (purposeOf(current) === purpose ? { phase: 'off' } : { phase: 'picking', purpose }));
  }, []);

  const run = useCallback(
    (purpose: PickPurpose, point: FramePoint) => {
      call.current += 1;
      const mine = call.current;
      setState({ phase: 'working', purpose, point });
      const settle = (next: PickState) => {
        if (call.current === mine) setState(next);
      };
      const fail = (error: unknown) => {
        settle({ phase: 'failed', purpose, point, message: failureText(error) });
      };
      if (purpose === 'find') {
        api.findThis(clipId, point).then((found) => {
          settle({ phase: 'found', point, found });
        }, fail);
      } else {
        api.cutOut(clipId, point).then((cutout) => {
          settle({ phase: 'cut', point, cutout });
        }, fail);
      }
    },
    [api, clipId],
  );

  const pick = useCallback(
    (point: FramePoint) => {
      if (state.phase === 'picking') run(state.purpose, point);
    },
    [run, state],
  );

  const retry = useCallback(() => {
    if (state.phase === 'failed') run(state.purpose, state.point);
  }, [run, state]);

  // Esc cancels picking and a call in flight.
  const isPicking = state.phase === 'picking' || state.phase === 'working' || state.phase === 'failed';
  useEffect(() => {
    if (!isPicking) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [isPicking, cancel]);

  // A new clip starts with pick mode off.
  useEffect(() => cancel, [clipId, cancel]);

  return { state, toggle, pick, cancel, retry };
}
