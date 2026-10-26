// Moment selection on the Search screen: picked segment ids in the order the user picked them,
// which is the order the editor receives them.

/**
 * Adds `id` at the end, or removes it when already picked.
 * @param selected - Picked ids in pick order.
 * @param id - Segment id tapped.
 * @returns The new selection.
 */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
}

/** What the Search screen hands the editor in router state. */
export interface EditorHandoff {
  segmentIds: string[];
}

/**
 * Reads the editor's router state, which may be anything (a reload drops it, a bookmark has none).
 * @param state - `location.state`.
 * @returns The picked segment ids, or an empty list.
 */
export function readEditorHandoff(state: unknown): string[] {
  if (typeof state !== 'object' || state === null || !('segmentIds' in state)) return [];
  const ids = state.segmentIds;
  return Array.isArray(ids) && ids.every((id) => typeof id === 'string') ? ids : [];
}

/**
 * Reads the `t` query parameter that deep-links into a clip at a second.
 * @param raw - `searchParams.get('t')`.
 * @returns Seconds >= 0, or null when missing or not a number.
 */
export function readStartParam(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
