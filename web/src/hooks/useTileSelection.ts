// The Gallery's selection (mock V4, redesign v2): a plain click selects one clip, ⌘-click
// toggles a clip, right-click acts on the selection when the clip is part of it, Esc clears.
// Select mode (owner ruling 2026-10-29, "Make a short" from several clips): a click ticks or
// unticks a clip, Shift-click ticks a range, and on the phone a long press starts the mode.
// Leaving the mode clears the selection; Esc leaves it.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { menuTargets, selectModeClick, tileClick, toggleSelection, type SelectModeState } from '../core/selection';

/** The selection and its handlers. */
export interface TileSelection {
  /** Selected clip ids, in selection order. */
  selected: string[];
  /**
   * For a tile's onClick: selects (⌘ toggles; in Select mode ticks, Shift ticks a range); never
   * follows the tile's link. `order` is every clip id as shown, for the range.
   */
  click: (clipId: string, event: MouseEvent<HTMLElement>, order?: readonly string[]) => void;
  /** For a tile's right-click: the ids the menu acts on, which become the selection. */
  targetsFor: (clipId: string) => string[];
  /** Drops ids that no longer exist (after a delete). */
  forget: (clipIds: readonly string[]) => void;
  /** Select mode is on. */
  isSelecting: boolean;
  /** Turns Select mode on, or off (which clears the selection). */
  setSelecting: (isOn: boolean) => void;
  /** A long press on a tile: Select mode on, with that clip ticked. */
  hold: (clipId: string) => void;
  /** A tap in Select mode (the phone): ticks or unticks the clip. */
  toggle: (clipId: string) => void;
}

const EMPTY: SelectModeState = { selected: [], anchor: null };

/**
 * Selection state for one grid.
 * @returns The selection.
 */
export function useTileSelection(): TileSelection {
  const [selected, setSelected] = useState<string[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  // The newest selection, also between renders: clicks that land before React re-renders (fast
  // ⌘-clicks) each build on the one before instead of on a stale copy.
  const latest = useRef<SelectModeState>(EMPTY);
  const mode = useRef(false);
  const update = useCallback((next: SelectModeState) => {
    latest.current = next;
    setSelected(next.selected);
  }, []);
  const setSelecting = useCallback(
    (isOn: boolean) => {
      mode.current = isOn;
      setIsSelecting(isOn);
      if (!isOn) update(EMPTY);
    },
    [update],
  );
  const hasSelection = selected.length > 0;

  useEffect(() => {
    if (!hasSelection && !isSelecting) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelecting(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [hasSelection, isSelecting, setSelecting]);

  const click = useCallback(
    (clipId: string, event: MouseEvent<HTMLElement>, order: readonly string[] = []) => {
      event.preventDefault();
      const now = latest.current;
      update(
        mode.current
          ? selectModeClick(now, clipId, order, event.shiftKey)
          : { selected: tileClick(now.selected, clipId, event.metaKey || event.ctrlKey), anchor: clipId },
      );
    },
    [update],
  );
  const targetsFor = useCallback(
    (clipId: string) => {
      const ids = menuTargets(latest.current.selected, clipId);
      update({ selected: ids, anchor: latest.current.anchor });
      return ids;
    },
    [update],
  );
  const forget = useCallback(
    (clipIds: readonly string[]) => {
      update({ ...latest.current, selected: latest.current.selected.filter((id) => !clipIds.includes(id)) });
    },
    [update],
  );
  const hold = useCallback(
    (clipId: string) => {
      mode.current = true;
      setIsSelecting(true);
      const now = latest.current;
      update({ selected: now.selected.includes(clipId) ? now.selected : [...now.selected, clipId], anchor: clipId });
    },
    [update],
  );
  const toggle = useCallback(
    (clipId: string) => {
      update({ selected: toggleSelection(latest.current.selected, clipId), anchor: clipId });
    },
    [update],
  );
  return { selected, click, targetsFor, forget, isSelecting, setSelecting, hold, toggle };
}
