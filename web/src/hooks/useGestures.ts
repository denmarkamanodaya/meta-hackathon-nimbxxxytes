// Touch gestures for timeline cards: drag a handle to reorder, swipe a card left to drop it.
// Each gesture has a button alternative on the card (move up / down, remove), so neither is the
// only way to do the edit.
import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * Index a dragged item lands on: one past every other item whose middle is above the pointer.
 * @param from - Index being dragged.
 * @param pointerY - Pointer y (viewport px).
 * @param midpoints - Vertical middle of every item at drag start, in list order.
 * @returns The target index.
 */
export function reorderTarget(from: number, pointerY: number, midpoints: readonly number[]): number {
  return midpoints.filter((mid, index) => index !== from && mid < pointerY).length;
}

/**
 * How far item `index` shifts while item `from` is dragged to `to`, to open a gap.
 * @param index - Item being drawn.
 * @param from - Dragged item.
 * @param to - Current target.
 * @param height - Dragged item's height plus the list gap, px.
 * @returns Vertical offset in px.
 */
export function shiftFor(index: number, from: number, to: number, height: number): number {
  if (from < to && index > from && index <= to) return -height;
  if (from > to && index >= to && index < from) return height;
  return 0;
}

/** Share of the card width a leftward swipe must pass to drop the card. */
export const SWIPE_DISMISS_RATIO = 0.35;

/**
 * Decides a swipe on release.
 * @param dx - Horizontal travel in px (negative = left).
 * @param width - Card width in px.
 * @returns `dismiss` past the threshold to the left, else `cancel`.
 */
export function swipeDecision(dx: number, width: number): 'dismiss' | 'cancel' {
  return width > 0 && dx < -width * SWIPE_DISMISS_RATIO ? 'dismiss' : 'cancel';
}

interface DragState {
  from: number;
  to: number;
  startY: number;
  offset: number;
  height: number;
  midpoints: number[];
}

/** Drag-to-reorder over a list whose items carry `data-reorder-item`. */
export interface DragReorder {
  /** Current drag, or null. */
  drag: Pick<DragState, 'from' | 'to' | 'offset' | 'height'> | null;
  /** Pointer handlers for item `index`'s drag handle. */
  handle: (index: number) => {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
  };
}

/**
 * Reorder by dragging a handle; calls `onMove(from, to)` on release.
 * @param onMove - Applies the move.
 * @returns See `DragReorder`.
 */
export function useDragReorder(onMove: (from: number, to: number) => void): DragReorder {
  const [drag, setDragState] = useState<DragState | null>(null);
  // Mirror in a ref so release reads the latest drag without a side effect in a state updater
  // (StrictMode runs updaters twice, which would apply the move twice).
  const latest = useRef<DragState | null>(null);
  const setDrag = useCallback((next: DragState | null) => {
    latest.current = next;
    setDragState(next);
  }, []);
  const finish = useCallback(() => {
    const current = latest.current;
    setDrag(null);
    if (current !== null && current.to !== current.from) onMove(current.from, current.to);
  }, [onMove, setDrag]);

  return {
    drag,
    handle: (index) => ({
      onPointerDown: (event) => {
        const item = event.currentTarget.closest('[data-reorder-item]');
        const list = item?.parentElement;
        if (!item || !list) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const rects = [...list.querySelectorAll(':scope > [data-reorder-item]')].map((el) =>
          el.getBoundingClientRect(),
        );
        const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
        setDrag({
          from: index,
          to: index,
          startY: event.clientY,
          offset: 0,
          height: item.getBoundingClientRect().height + gap,
          midpoints: rects.map((rect) => rect.top + rect.height / 2),
        });
      },
      onPointerMove: (event) => {
        const current = latest.current;
        if (current === null) return;
        const y = event.clientY;
        setDrag({ ...current, offset: y - current.startY, to: reorderTarget(current.from, y, current.midpoints) });
      },
      onPointerUp: finish,
      onPointerCancel: () => {
        setDrag(null);
      },
    }),
  };
}

/** Swipe-left-to-drop on one card. */
export interface SwipeDismiss {
  /** Current horizontal offset in px (0 when idle). */
  offset: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
}

/**
 * Tracks a horizontal swipe; vertical travel hands the gesture back to scrolling. Starts on the
 * card body only, never on its controls.
 * @param onDismiss - Called when the card is swiped far enough left.
 * @returns See `SwipeDismiss`.
 */
export function useSwipeDismiss(onDismiss: () => void): SwipeDismiss {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const reset = () => {
    start.current = null;
    setOffset(0);
  };
  return {
    offset,
    onPointerDown: (event) => {
      const target = event.target as Element;
      if (target.closest('button, input, [data-no-swipe]') !== null) return;
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove: (event) => {
      const origin = start.current;
      if (origin === null) return;
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        reset();
        return;
      }
      setOffset(Math.min(0, dx));
    },
    onPointerUp: (event) => {
      const origin = start.current;
      if (origin === null) return;
      const width = event.currentTarget.getBoundingClientRect().width;
      const decision = swipeDecision(event.clientX - origin.x, width);
      reset();
      if (decision === 'dismiss') onDismiss();
    },
    onPointerCancel: reset,
  };
}
