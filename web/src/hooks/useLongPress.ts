// Long-press detection for selection mode. Selecting is also reachable with a plain tap on the
// "Select" button, so the long press is a shortcut, never the only way.
import { useCallback, useEffect, useRef } from 'react';

/** Hold time in ms that counts as a long press. */
export const LONG_PRESS_MS = 450;
/** Finger travel in px that cancels a long press (the user is scrolling). */
export const LONG_PRESS_SLOP_PX = 10;

/** Pointer handlers to spread on the pressable element, plus the click guard. */
export interface LongPress {
  onPointerDown: (event: { clientX: number; clientY: number }) => void;
  onPointerMove: (event: { clientX: number; clientY: number }) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  /** True once if the click that follows a long press should be ignored; resets itself. */
  consumeLongPress: () => boolean;
}

/**
 * Calls `onLongPress` after the pointer is held still for `LONG_PRESS_MS`.
 * @param onLongPress - What a long press does.
 * @returns See `LongPress`.
 */
export function useLongPress(onLongPress: () => void): LongPress {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (event) => {
      cancel();
      fired.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        fired.current = true;
        start.current = null;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (origin === null) return;
      const moved = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (moved > LONG_PRESS_SLOP_PX) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    consumeLongPress: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}
