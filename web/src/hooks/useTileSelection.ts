// The Mac Library's tile selection (mock V4): ⌘-click toggles a tile, a plain click opens it and
// clears the selection, right-click acts on the selection when the tile is part of it, Esc clears.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { menuTargets, tileClick } from '../core/selection';

/** The selection and its handlers. */
export interface TileSelection {
  /** Selected clip ids, in selection order. */
  selected: string[];
  /** For a tile's onClick: ⌘-click selects instead of opening. */
  click: (clipId: string, event: MouseEvent<HTMLElement>) => void;
  /** For a tile's right-click: the ids the menu acts on, which become the selection. */
  targetsFor: (clipId: string) => string[];
  /** Drops ids that no longer exist (after a delete). */
  forget: (clipIds: readonly string[]) => void;
}

/**
 * Selection state for one grid.
 * @returns The selection.
 */
export function useTileSelection(): TileSelection {
  const [selected, setSelected] = useState<string[]>([]);
  // The newest selection, also between renders: clicks that land before React re-renders (fast
  // ⌘-clicks) each build on the one before instead of on a stale copy.
  const latest = useRef<string[]>([]);
  const update = useCallback((next: string[]) => {
    latest.current = next;
    setSelected(next);
  }, []);
  const hasSelection = selected.length > 0;

  useEffect(() => {
    if (!hasSelection) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') update([]);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [hasSelection, update]);

  const click = useCallback(
    (clipId: string, event: MouseEvent<HTMLElement>) => {
      const next = tileClick(latest.current, clipId, event.metaKey);
      if (!next.shouldOpen) event.preventDefault();
      update(next.selected);
    },
    [update],
  );
  const targetsFor = useCallback(
    (clipId: string) => {
      const ids = menuTargets(latest.current, clipId);
      update(ids);
      return ids;
    },
    [update],
  );
  const forget = useCallback(
    (clipIds: readonly string[]) => {
      update(latest.current.filter((id) => !clipIds.includes(id)));
    },
    [update],
  );
  return { selected, click, targetsFor, forget };
}
