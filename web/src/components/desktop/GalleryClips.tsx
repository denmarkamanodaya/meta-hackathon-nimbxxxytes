// The clips of the Mac Gallery and of a project page (redesign v2, Gallery V1 grid and V2 list):
// square tiles in a grid sized by the slider, or a table with 40 px square thumbnails. A click
// selects (⌘ adds; in Select mode it ticks and Shift ticks a range, and the list grows a tick
// column), a double click or Enter opens, a list header sorts by its column (click again to flip), right-click opens the clip menu with its Add
// to segment submenu; ⌘R shows the clip in Finder and ⌘⌫ deletes the selection. On the Gallery,
// uploads come first: dashed tiles in the grid, rows at the top of the list. With `items` (the
// Gallery's mixed view, and a segment page), photos, iListen recordings and iRead documents sit
// among the clips in that order: they select, tick and drag like clips, show where they are and
// their segments in the list, a double click opens their page, and right-click opens their menu
// (Open, Add to segment ›, and Remove from this segment on a segment page).
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { pickLiveClips } from '../../core/clip-view';
import { galleryRow, gridColumns, nextSort, type GallerySort, type GalleryView } from '../../core/gallery';
import { driveItemRef, itemRef, itemRow, itemThumb, itemTitle, videoItem, type GalleryItem, type OtherItem } from '../../core/gallery-items';
import { itemPagePath } from '../../hooks/gallery-paths';
import { GALLERY_LIST_COLUMNS, GALLERY_LIST_COLUMNS_NARROW, GALLERY_LIST_HEADING, uploadRowSpans, type GalleryListColumn } from '../../core/gallery-list';
import type { GalleryUpload } from '../../core/gallery-uploads';
import { clipAvailability, itemAvailability } from '../../core/on-this-mac';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { useMakeShortFromClip } from '../../hooks/useClips';
import { useIsMacApp, useKeepOffline, useRevealClip, useSyncStatus } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import { useNarrowWindow } from '../../hooks/useNarrowWindow';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import type { TileSelection } from '../../hooks/useTileSelection';
import type { SyncStatus } from '../../core/desktop-sync';
import type { ClipSummary, Project } from '../../services/api/types';
import { ClipDeleteSheet, type DeleteTarget } from '../ClipDeleteSheet';
import { writeClipDrag } from './clip-drag';
import { clipMenuItems, itemMenuItems } from './clip-menu';
import { MacClipTile } from './MacClipTile';
import { MacItemTile } from './MacItemTile';
import { NewProjectSheet } from './NewProjectSheet';
import { QuickLook } from './QuickLook';
import { SelectTick } from './SelectTick';
import { UploadRow, UploadTile } from './GalleryUploads';
import { addToProjectItems } from './project-menu';
import './GalleryClips.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

/** Props for `GalleryClips`. */
export interface GalleryClipsProps {
  clips: ClipSummary[];
  view: GalleryView;
  /** Thumbnail size step, 1–5 (grid only). */
  size: number;
  selection: TileSelection;
  /** A last grid cell after the tiles (the segment page's "Drag items here"). */
  extraTile?: ReactNode;
  /** After a delete: reload the list. */
  onDeleted: () => void;
  /** On a segment page: the project, so the menus can take entries out of it. */
  projectId?: string;
  /** On the Gallery: uploads shown before the clips. */
  uploads?: readonly GalleryUpload[];
  /** Cancels an upload by its transfer id. */
  onCancelUpload?: (transferId: string) => void;
  /** The clips' order; with `onSort`, the list's headers sort by their column. */
  sort?: GallerySort;
  /** A header click's new order. */
  onSort?: (next: GallerySort) => void;
  /**
   * The Gallery's mixed view: every entry in its order (the clips among them); left out, `clips`
   * alone are shown.
   */
  items?: readonly GalleryItem[];
}

const NO_UPLOADS: readonly GalleryUpload[] = [];

/** The list cells with their own look: the name in primary text, the length in mono. */
const CELL_CLASS: Partial<Record<GalleryListColumn, string>> = { name: 'gallery-list__name', length: 'gallery-list__mono' };
const ignoreCancel = () => undefined;

/** The delete sheet's rows for some clip ids. */
const deleteTargets = (clips: readonly ClipSummary[], ids: readonly string[]): DeleteTarget[] =>
  clips.filter((clip) => ids.includes(clip.clip_id)).map((clip) => ({ clipId: clip.clip_id, title: clip.title }));

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * A list column's heading: a button that sorts by the column when the page sorts, with an arrow on
 * the column in use; plain text otherwise.
 * @param props - The column and the page's sort.
 * @returns The header cell.
 */
function HeaderCell({ column, sort, onSort }: { column: GalleryListColumn; sort: GallerySort | undefined; onSort: ((next: GallerySort) => void) | undefined }) {
  if (sort === undefined || onSort === undefined) return <th scope="col">{GALLERY_LIST_HEADING[column]}</th>;
  const isActive = sort.by === column;
  return (
    <th scope="col" aria-sort={isActive ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className={isActive ? 'gallery-list__sort gallery-list__sort--on' : 'gallery-list__sort'}
        onClick={() => {
          onSort(nextSort(sort, column));
        }}
      >
        {GALLERY_LIST_HEADING[column]}
        {isActive && (
          <span className={sort.dir === 'asc' ? 'gallery-list__arrow gallery-list__arrow--up' : 'gallery-list__arrow'} aria-hidden="true">
            <Icon name="chevron-down" size="xs" />
          </span>
        )}
      </button>
    </th>
  );
}

/** A photo's, a recording's or a document's row in the list: its name, kind, day, length, size, where it is and its segments. */
function ItemRow({
  item,
  selection,
  order,
  onOpen,
  onMenu,
  onDragStart,
  columns,
  sync,
  projects,
}: {
  item: OtherItem;
  selection: TileSelection;
  order: readonly string[];
  onOpen: (itemId: string) => void;
  onMenu: (itemId: string, event: MouseEvent<HTMLElement>) => void;
  onDragStart: (itemId: string, event: DragEvent<HTMLElement>) => void;
  columns: readonly GalleryListColumn[];
  sync: SyncStatus | null;
  projects: readonly Project[];
}) {
  const row = itemRow(item, itemAvailability(driveItemRef(item), sync), projects);
  const isSelected = selection.selected.includes(item.id);
  const thumb = itemThumb(item);
  return (
    <tr
      className={isSelected ? 'gallery-list__row gallery-list__row--selected' : 'gallery-list__row'}
      aria-selected={isSelected}
      tabIndex={0}
      draggable
      onDragStart={(event) => {
        onDragStart(item.id, event);
      }}
      onClick={(event) => {
        selection.click(item.id, event, order);
      }}
      onDoubleClick={() => {
        onOpen(item.id);
      }}
      onContextMenu={(event) => {
        onMenu(item.id, event);
      }}
    >
      {selection.isSelecting && (
        <td className="gallery-list__tick">
          <SelectTick isOn={isSelected} />
        </td>
      )}
      <td>
        <span className="gallery-list__thumb">
          {thumb === null ? <Icon name={item.kind === 'recording' ? 'wave' : item.kind === 'photo' ? 'camera' : 'document'} size="sm" /> : <img src={thumb} alt="" loading="lazy" />}
        </span>
      </td>
      {columns.map((column) => (
        <td key={column} className={CELL_CLASS[column]}>
          {row[column]}
        </td>
      ))}
    </tr>
  );
}

/**
 * The grid or the list, with the clip menu, the item menu, the delete sheet and the New segment sheet.
 * @param props - See `GalleryClipsProps`.
 * @returns The clips.
 */
export function GalleryClips({
  clips,
  view,
  size,
  selection,
  extraTile,
  onDeleted,
  projectId,
  uploads = NO_UPLOADS,
  onCancelUpload = ignoreCancel,
  sort,
  onSort,
  items,
}: GalleryClipsProps) {
  const navigate = useNavigate();
  const columns = useNarrowWindow() ? GALLERY_LIST_COLUMNS_NARROW : GALLERY_LIST_COLUMNS;
  const uploadSpans = uploadRowSpans(columns);
  const { state: syncState } = useSyncStatus();
  const sync = syncState.status === 'ready' ? syncState.data : null;
  const { state: projectState } = useProjects();
  const projects = projectState.status === 'ready' ? projectState.data : [];
  const projectActions = useProjectActions();
  const makeShort = useMakeShortFromClip();
  const keep = useKeepOffline();
  const reveal = useRevealClip();
  const isMacApp = useIsMacApp();
  const menu = useMenu();
  const itemMenu = useMenu();
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [itemMenuIds, setItemMenuIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DeleteTarget[]>([]);
  const [newFor, setNewFor] = useState<string[] | null>(null);
  const [lookId, setLookId] = useState<string | null>(null);
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const targets = clips.filter((clip) => menuIds.includes(clip.clip_id));
  const shown = useMemo<readonly GalleryItem[]>(() => items ?? clips.map((clip) => ({ kind: 'video', id: clip.clip_id, clip })), [items, clips]);
  const order = useMemo(() => shown.map((item) => item.id), [shown]);
  const itemTargets = shown.filter((item) => itemMenuIds.includes(item.id));
  const open = useCallback(
    (clipId: string) => {
      void navigate(`/clips/${encodeURIComponent(clipId)}`);
    },
    [navigate],
  );
  /** Opens any entry: a clip's page, or a recording's or a document's. */
  const openItem = useCallback(
    (itemId: string) => {
      void navigate(itemPagePath(itemRef(itemId)));
    },
    [navigate],
  );
  /** A drag carries the whole selection when the dragged entry is part of it. */
  const startDrag = (itemId: string, event: DragEvent<HTMLElement>) => {
    writeClipDrag(event.dataTransfer, selection.selected.includes(itemId) ? selection.selected : [itemId]);
  };
  /** A clip's menu acts on the ticked clips; an item's on every ticked entry. */
  const openMenu = (clipId: string, event: MouseEvent<HTMLElement>) => {
    setMenuIds(selection.targetsFor(clipId));
    menu.openAtPointer(event);
  };
  const openItemMenu = (itemId: string, event: MouseEvent<HTMLElement>) => {
    setItemMenuIds(selection.targetsFor(itemId));
    itemMenu.openAtPointer(event);
  };

  const { selected } = selection;
  useEffect(() => {
    const last = selected.at(-1);
    if (last === undefined) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('dialog[open], [role="menu"]') !== null) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        openItem(last);
      } else if (event.key === ' ') {
        event.preventDefault();
        setLookId(last);
      } else if (event.metaKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        reveal(last);
      } else if (event.metaKey && event.key === 'Backspace') {
        event.preventDefault();
        setDeleting(deleteTargets(clips, selected));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [selected, clips, navigate, reveal, openItem]);

  return (
    <>
      {view === 'grid' ? (
        <ul className="gallery-grid" style={{ gridTemplateColumns: `repeat(${String(gridColumns(size))}, minmax(0, 1fr))` }}>
          {uploads.map((upload) => (
            <UploadTile key={upload.key} upload={upload} onCancel={onCancelUpload} />
          ))}
          {shown.map((item) =>
            item.kind === 'video' ? (
              <MacClipTile
                key={item.id}
                clip={item.clip}
                isLive={live.has(item.id)}
                isSelected={selected.includes(item.id)}
                isSelecting={selection.isSelecting}
                availability={clipAvailability(item.id, sync)}
                onClick={(event) => {
                  selection.click(item.id, event, order);
                }}
                onOpen={() => {
                  open(item.id);
                }}
                onContextMenu={(event) => {
                  openMenu(item.id, event);
                }}
                onDragStart={(event) => {
                  startDrag(item.id, event);
                }}
              />
            ) : (
              <MacItemTile
                key={item.id}
                item={item}
                isSelected={selected.includes(item.id)}
                isSelecting={selection.isSelecting}
                onClick={(event) => {
                  selection.click(item.id, event, order);
                }}
                onOpen={() => {
                  openItem(item.id);
                }}
                onContextMenu={(event) => {
                  openItemMenu(item.id, event);
                }}
                onDragStart={(event) => {
                  startDrag(item.id, event);
                }}
              />
            ),
          )}
          {extraTile !== undefined && <li className="gallery-grid__extra">{extraTile}</li>}
        </ul>
      ) : (
        <table className="gallery-list">
          <thead>
            <tr>
              <th scope="col" className="gallery-list__thumb-col">
                <span className="visually-hidden">Thumbnail</span>
              </th>
              {selection.isSelecting && (
                <th scope="col" className="gallery-list__tick-col">
                  <span className="visually-hidden">Ticked</span>
                </th>
              )}
              {columns.map((column) => (
                <HeaderCell key={column} column={column} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {uploads.map((upload) => (
              <UploadRow key={upload.key} upload={upload} spans={uploadSpans} onCancel={onCancelUpload} hasTickCell={selection.isSelecting} />
            ))}
            {shown.map((item) => {
              if (item.kind !== 'video') {
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    selection={selection}
                    order={order}
                    onOpen={openItem}
                    onMenu={openItemMenu}
                    onDragStart={startDrag}
                    columns={columns}
                    sync={sync}
                    projects={projects}
                  />
                );
              }
              const clip = item.clip;
              const row = galleryRow(clip, clipAvailability(clip.clip_id, sync), projects);
              const isSelected = selected.includes(clip.clip_id);
              return (
                <tr
                  key={clip.clip_id}
                  className={isSelected ? 'gallery-list__row gallery-list__row--selected' : 'gallery-list__row'}
                  aria-selected={isSelected}
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => {
                    startDrag(clip.clip_id, event);
                  }}
                  onClick={(event) => {
                    selection.click(clip.clip_id, event, order);
                  }}
                  onDoubleClick={() => {
                    open(clip.clip_id);
                  }}
                  onContextMenu={(event) => {
                    openMenu(clip.clip_id, event);
                  }}
                >
                  {selection.isSelecting && (
                    <td className="gallery-list__tick">
                      <SelectTick isOn={isSelected} />
                    </td>
                  )}
                  <td>
                    <span className="gallery-list__thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" loading="lazy" />}</span>
                  </td>
                  {columns.map((column) => (
                    <td key={column} className={CELL_CLASS[column]}>
                      {row[column]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Menu
        anchor={menu.anchor}
        label={targets.length === 1 ? (targets[0]?.title ?? 'Clip') : `${String(targets.length)} clips`}
        onClose={menu.close}
        items={clipMenuItems(targets, {
          open,
          quickLook: setLookId,
          makeShort,
          ...(isMacApp ? { keepOffline: keep, reveal } : {}),
          remove: () => {
            setDeleting(deleteTargets(clips, menuIds));
          },
          pinned: sync?.pinnedClipIds ?? [],
          ...(projectId === undefined
            ? {}
            : {
                removeFromProject: () => {
                  void projectActions.removeItems(projectId, menuIds);
                },
              }),
          projectItems: addToProjectItems(projects, targets.map(videoItem), projectActions.toggle, () => {
            setNewFor(menuIds);
          }),
        })}
      />
      <Menu
        anchor={itemMenu.anchor}
        label={itemTargets.length === 1 && itemTargets[0] !== undefined ? itemTitle(itemTargets[0]) : `${String(itemTargets.length)} items`}
        onClose={itemMenu.close}
        items={itemMenuItems({
          open: () => {
            const first = itemTargets[0];
            if (first !== undefined) openItem(first.id);
          },
          projectItems: addToProjectItems(projects, itemTargets, projectActions.toggle, () => {
            setNewFor(itemMenuIds);
          }),
          ...(projectId === undefined
            ? {}
            : {
                removeFromProject: () => {
                  void projectActions.removeItems(projectId, itemMenuIds);
                },
              }),
        })}
      />
      <QuickLook
        clip={clips.find((clip) => clip.clip_id === lookId) ?? null}
        onClose={() => {
          setLookId(null);
        }}
      />
      <NewProjectSheet
        open={newFor !== null}
        itemIds={newFor ?? []}
        onClose={() => {
          setNewFor(null);
        }}
      />
      <ClipDeleteSheet
        targets={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={(outcome) => {
          setDeleting([]);
          selection.forget(outcome.deleted);
          onDeleted();
        }}
      />
    </>
  );
}
