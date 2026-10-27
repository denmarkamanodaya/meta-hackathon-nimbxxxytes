// The right-click menu of Gallery tiles and rows (redesign v2, Gallery list board): for one clip
// Open, Quick look, Make a short, Add to project ›, Make available offline, Show in Finder and
// Delete…; for several, Add to project › and Delete N clips….
import type { MenuEntry } from '../../design/Menu';
import type { ClipSummary } from '../../services/api/types';

/** What the menu does. */
export interface ClipMenuActions {
  open: (clipId: string) => void;
  makeShort: (clipId: string) => void;
  keepOffline: (clipId: string, offline: boolean) => void;
  reveal: (clipId: string) => void;
  remove: () => void;
  /** The Add to project submenu's entries. */
  projectItems: MenuEntry[];
  /** Clip ids kept offline. */
  pinned: readonly string[];
  /** On a project page: takes the clips out of that project. */
  removeFromProject?: () => void;
}

/**
 * The entries for the clips the menu acts on.
 * @param targets - One clip or several.
 * @param actions - See `ClipMenuActions`.
 * @returns The entries.
 */
export function clipMenuItems(targets: readonly ClipSummary[], actions: ClipMenuActions): MenuEntry[] {
  const addTo: MenuEntry = { kind: 'submenu', label: 'Add to project', items: actions.projectItems };
  const takeOut: MenuEntry[] =
    actions.removeFromProject === undefined ? [] : [{ kind: 'item', label: 'Remove from this project', onSelect: actions.removeFromProject }];
  const only = targets.length === 1 ? targets[0] : undefined;
  if (only === undefined) {
    return [addTo, ...takeOut, { kind: 'separator' }, { kind: 'item', label: `Delete ${String(targets.length)} clips…`, hint: '⌘⌫', isDanger: true, onSelect: actions.remove }];
  }
  const id = only.clip_id;
  const isReady = only.status === 'ready';
  const isKept = actions.pinned.includes(id);
  return [
    { kind: 'item', label: 'Open', hint: '⏎', onSelect: () => { actions.open(id); } },
    { kind: 'item', label: 'Quick look', hint: 'Space', onSelect: () => { actions.open(id); } },
    { kind: 'item', label: 'Make a short', isDisabled: !isReady || only.segment_count === 0, onSelect: () => { actions.makeShort(id); } },
    { kind: 'separator' },
    addTo,
    ...takeOut,
    {
      kind: 'item',
      label: isKept ? 'Stop keeping offline' : 'Make available offline',
      isDisabled: !isReady,
      onSelect: () => {
        actions.keepOffline(id, !isKept);
      },
    },
    { kind: 'item', label: 'Show in Finder', hint: '⌘R', onSelect: () => { actions.reveal(id); } },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete…', hint: '⌘⌫', isDanger: true, onSelect: actions.remove },
  ];
}
