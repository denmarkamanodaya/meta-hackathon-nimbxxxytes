// The clips of the Mac Gallery and of a project page (redesign v2, Gallery V1 grid and V2 list):
// square tiles in a grid sized by the slider, or a table with 40 px square thumbnails. A click
// selects (⌘ adds), a double click or Enter opens, right-click opens the clip menu with its Add
// to project submenu; ⌘R shows the clip in Finder and ⌘⌫ deletes the selection.
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { pickLiveClips } from '../../core/clip-view';
import { galleryRow, gridColumns, type GalleryView } from '../../core/gallery';
import { clipAvailability } from '../../core/on-this-mac';
import { Menu } from '../../design/Menu';
import { useMakeShortFromClip } from '../../hooks/useClips';
import { useKeepOffline, useRevealClip, useSyncStatus } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import type { TileSelection } from '../../hooks/useTileSelection';
import type { ClipSummary } from '../../services/api/types';
import { ClipDeleteSheet, type DeleteTarget } from '../ClipDeleteSheet';
import { clipMenuItems } from './clip-menu';
import { MacClipTile } from './MacClipTile';
import { NewProjectSheet } from './NewProjectSheet';
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
  /** A last grid cell after the tiles (the project page's "Drag clips here"). */
  extraTile?: ReactNode;
  /** After a delete: reload the list. */
  onDeleted: () => void;
}

/** The delete sheet's rows for some clip ids. */
const deleteTargets = (clips: readonly ClipSummary[], ids: readonly string[]): DeleteTarget[] =>
  clips.filter((clip) => ids.includes(clip.clip_id)).map((clip) => ({ clipId: clip.clip_id, title: clip.title }));

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * The grid or the list, with the clip menu, the delete sheet and the New project sheet.
 * @param props - See `GalleryClipsProps`.
 * @returns The clips.
 */
export function GalleryClips({ clips, view, size, selection, extraTile, onDeleted }: GalleryClipsProps) {
  const navigate = useNavigate();
  const { state: syncState } = useSyncStatus();
  const sync = syncState.status === 'ready' ? syncState.data : null;
  const { state: projectState } = useProjects();
  const projects = projectState.status === 'ready' ? projectState.data : [];
  const projectActions = useProjectActions();
  const makeShort = useMakeShortFromClip();
  const keep = useKeepOffline();
  const reveal = useRevealClip();
  const menu = useMenu();
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DeleteTarget[]>([]);
  const [newFor, setNewFor] = useState<string[] | null>(null);
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const targets = clips.filter((clip) => menuIds.includes(clip.clip_id));
  const open = (clipId: string) => {
    void navigate(`/clips/${encodeURIComponent(clipId)}`);
  };
  const openMenu = (clipId: string, event: MouseEvent<HTMLElement>) => {
    setMenuIds(selection.targetsFor(clipId));
    menu.openAtPointer(event);
  };

  const { selected } = selection;
  useEffect(() => {
    const last = selected.at(-1);
    if (last === undefined) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) || document.querySelector('dialog[open], [role="menu"]') !== null) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void navigate(`/clips/${encodeURIComponent(last)}`);
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
  }, [selected, clips, navigate, reveal]);

  return (
    <>
      {view === 'grid' ? (
        <ul className="gallery-grid" style={{ gridTemplateColumns: `repeat(${String(gridColumns(size))}, minmax(0, 1fr))` }}>
          {clips.map((clip) => (
            <MacClipTile
              key={clip.clip_id}
              clip={clip}
              isLive={live.has(clip.clip_id)}
              isSelected={selected.includes(clip.clip_id)}
              availability={clipAvailability(clip.clip_id, sync)}
              onClick={(event) => {
                selection.click(clip.clip_id, event);
              }}
              onOpen={() => {
                open(clip.clip_id);
              }}
              onContextMenu={(event) => {
                openMenu(clip.clip_id, event);
              }}
            />
          ))}
          {extraTile !== undefined && <li className="gallery-grid__extra">{extraTile}</li>}
        </ul>
      ) : (
        <table className="gallery-list">
          <thead>
            <tr>
              <th scope="col" className="gallery-list__thumb-col">
                <span className="visually-hidden">Thumbnail</span>
              </th>
              {['Name', 'Recorded', 'Length', 'Size', 'Moments', 'Faces', 'Where', 'Project'].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {clips.map((clip) => {
              const row = galleryRow(clip, clipAvailability(clip.clip_id, sync), projects);
              const isSelected = selected.includes(clip.clip_id);
              return (
                <tr
                  key={clip.clip_id}
                  className={isSelected ? 'gallery-list__row gallery-list__row--selected' : 'gallery-list__row'}
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={(event) => {
                    selection.click(clip.clip_id, event);
                  }}
                  onDoubleClick={() => {
                    open(clip.clip_id);
                  }}
                  onContextMenu={(event) => {
                    openMenu(clip.clip_id, event);
                  }}
                >
                  <td>
                    <span className="gallery-list__thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" loading="lazy" />}</span>
                  </td>
                  <td className="gallery-list__name">{row.name}</td>
                  <td>{row.recorded}</td>
                  <td className="gallery-list__mono">{row.length}</td>
                  <td>{row.size}</td>
                  <td>{row.moments}</td>
                  <td>{row.faces}</td>
                  <td>{row.where}</td>
                  <td>{row.project}</td>
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
          makeShort,
          keepOffline: keep,
          reveal,
          remove: () => {
            setDeleting(deleteTargets(clips, menuIds));
          },
          pinned: sync?.pinnedClipIds ?? [],
          projectItems: addToProjectItems(projects, targets, projectActions.toggle, () => {
            setNewFor(menuIds);
          }),
        })}
      />
      <NewProjectSheet
        open={newFor !== null}
        clipIds={newFor ?? []}
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
