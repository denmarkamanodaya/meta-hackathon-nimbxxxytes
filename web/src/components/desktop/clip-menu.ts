// The right-click menu of Gallery tiles and rows (redesign v2, Gallery list board): for one clip
// Open, Quick look, Make a short, Add to segment ›, Make available offline, Show in Finder and
// Delete…; for several, Add to segment › and Delete N clips…. In a browser (the wide-screen PWA)
// there is no drive or Finder, so the page leaves out the offline and Finder actions and the menu
// drops their entries.
import { SEGMENT_COPY } from '../../core/copy';
import type { MenuEntry } from '../../design/Menu';
import type { ClipSummary } from '../../services/api/types';

/** What the menu does. */
export interface ClipMenuActions {
  open: (clipId: string) => void;
  quickLook: (clipId: string) => void;
  makeShort: (clipId: string) => void;
  /** Keeps a clip on this Mac; left out in a browser. */
  keepOffline?: (clipId: string, offline: boolean) => void;
  /** Shows a clip in Finder; left out in a browser. */
  reveal?: (clipId: string) => void;
  remove: () => void;
  /** The Add to segment submenu's entries. */
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
  const addTo: MenuEntry = { kind: 'submenu', label: SEGMENT_COPY.addTo, items: actions.projectItems };
  const takeOut: MenuEntry[] =
    actions.removeFromProject === undefined ? [] : [{ kind: 'item', label: SEGMENT_COPY.removeFromThis, onSelect: actions.removeFromProject }];
  const only = targets.length === 1 ? targets[0] : undefined;
  if (only === undefined) {
    return [addTo, ...takeOut, { kind: 'separator' }, { kind: 'item', label: `Delete ${String(targets.length)} clips…`, hint: '⌘⌫', isDanger: true, onSelect: actions.remove }];
  }
  const id = only.clip_id;
  const isReady = only.status === 'ready';
  const isKept = actions.pinned.includes(id);
  const { keepOffline, reveal } = actions;
  const macOnly: MenuEntry[] = [
    ...(keepOffline === undefined
      ? []
      : [
          {
            kind: 'item',
            label: isKept ? 'Stop keeping offline' : 'Make available offline',
            isDisabled: !isReady,
            onSelect: () => {
              keepOffline(id, !isKept);
            },
          } as const,
        ]),
    ...(reveal === undefined ? [] : [{ kind: 'item', label: 'Show in Finder', hint: '⌘R', onSelect: () => { reveal(id); } } as const]),
  ];
  return [
    { kind: 'item', label: 'Open', hint: '⏎', onSelect: () => { actions.open(id); } },
    { kind: 'item', label: 'Quick look', hint: 'Space', onSelect: () => { actions.quickLook(id); } },
    { kind: 'item', label: 'Make a short', isDisabled: !isReady || only.segment_count === 0, onSelect: () => { actions.makeShort(id); } },
    { kind: 'separator' },
    addTo,
    ...takeOut,
    ...macOnly,
    { kind: 'separator' },
    { kind: 'item', label: 'Delete…', hint: '⌘⌫', isDanger: true, onSelect: actions.remove },
  ];
}

/** What the menu of a recording, a document or a photo does. */
export interface ItemMenuActions {
  open: () => void;
  /** The Add to segment submenu's entries. */
  projectItems: MenuEntry[];
  /** On a segment page: takes the entries out of that segment. */
  removeFromProject?: () => void;
}

/**
 * The right-click menu of a recording, a document or a photo: Open, Add to segment › and, on a
 * segment page, Remove from this segment.
 * @param actions - See `ItemMenuActions`.
 * @returns The entries.
 */
export function itemMenuItems(actions: ItemMenuActions): MenuEntry[] {
  return [
    { kind: 'item', label: 'Open', onSelect: actions.open },
    { kind: 'submenu', label: SEGMENT_COPY.addTo, items: actions.projectItems },
    ...(actions.removeFromProject === undefined ? [] : [{ kind: 'item', label: SEGMENT_COPY.removeFromThis, onSelect: actions.removeFromProject } as const]),
  ];
}
