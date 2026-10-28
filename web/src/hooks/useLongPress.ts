// A long press on a touch screen (the phone Library's way into Select mode): holding a pointer
// still for `LONG_PRESS_MS` fires once, and the click that follows the release is swallowed so
// the tile does not also open. Moving the finger (a scroll) or lifting it early cancels. The
// Library's Select button is the single-pointer alternative.
import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** How long a press must be held, ms. */
export const LONG_PRESS_MS = 500;

/** Travel in px that turns a press into a scroll. */
const MOVE_SLOP_PX = 10;

/** Pointer handlers for the pressed element. */
export interface LongPressHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  /** Swallows the click right after a long press; returns true when it did. */
  swallowClick: (event: MouseEvent<HTMLElement>) => boolean;
  /** Stops the system menu a held link would open (only during a press). */
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Detects a long press.
 * @param onHold - Called once when the press has been held long enough.
 * @returns The handlers.
 */
export function useLongPress(onHold: () => void): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const didHold = useRef(false);
  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      cancel();
      didHold.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        didHold.current = true;
        onHold();
      }, LONG_PRESS_MS);
    },
    [cancel, onHold],
  );
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const from = start.current;
      if (from !== null && Math.hypot(event.clientX - from.x, event.clientY - from.y) > MOVE_SLOP_PX) cancel();
    },
    [cancel],
  );
  const swallowClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!didHold.current) return false;
    didHold.current = false;
    event.preventDefault();
    return true;
  }, []);
  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    // Only while a press is held or just fired: a mouse right-click keeps the browser menu.
    if (timer.current !== null || didHold.current) event.preventDefault();
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, swallowClick, onContextMenu };
}
