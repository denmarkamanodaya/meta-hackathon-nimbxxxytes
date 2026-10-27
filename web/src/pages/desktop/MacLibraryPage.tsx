// Library in the Mac app (mock M1): the title, the dark "Ask your footage anything…" bar and
// Upload in one row; two storage tiles (in your cloud, on this Mac); then
// clips by recording day in a 5-column grid. ⌘-click selects tiles; right-click opens the clip
// menu or "Delete N clips…" (mock V4) behind one confirm sheet.
import { useMemo, useState, type MouseEvent } from 'react';
import { Link } from 'react-router';
import { ClipDeleteSheet, type DeleteTarget } from '../../components/ClipDeleteSheet';
import { MacClipTile } from '../../components/desktop/MacClipTile';
import { LoadError } from '../../components/LoadError';
import { SettingsSheet } from '../../components/SettingsSheet';
import { pickLiveClips } from '../../core/clip-view';
import { groupByDay } from '../../core/day-groups';
import { storageTiles, type SyncStatus } from '../../core/desktop-sync';
import { buttonClassName } from '../../design/Button';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { useClips, useMakeShortFromClip } from '../../hooks/useClips';
import { useSyncStatus } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import { useTileSelection, type TileSelection } from '../../hooks/useTileSelection';
import { useStorage } from '../../hooks/useOverview';
import type { ClipSummary } from '../../services/api/types';
import './MacLibraryPage.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

function Tiles({ sync }: { sync: SyncStatus | null }) {
  const storage = useStorage();
  const cloud = storage.status === 'ready' ? { bytes: storage.data.cloud_bytes, clips: storage.data.clip_count } : null;
  return (
    <section className="mac-library__tiles" aria-label="Storage">
      {storageTiles(cloud, sync).map((tile) => (
        <div key={tile.label} className="mac-library__tile">
          <span className="mac-library__muted">{tile.label}</span>
          <span className={tile.isAccent ? 'mac-library__value mac-library__value--accent' : 'mac-library__value'}>
            {tile.value}
          </span>
          <span className="mac-library__muted">{tile.line}</span>
        </div>
      ))}
    </section>
  );
}

interface DaysProps {
  clips: ClipSummary[];
  selection: TileSelection;
  onTileMenu: (clipId: string, event: MouseEvent<HTMLElement>) => void;
}

function Days({ clips, selection, onTileMenu }: DaysProps) {
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const groups = useMemo(() => groupByDay(clips, new Date()), [clips]);
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className="mac-library__day" aria-label={group.label}>
          <div className="mac-library__day-head">
            <h2 className="mac-library__day-title">{group.label}</h2>
            <span className="mac-library__muted">
              {`${String(group.count)} ${group.count === 1 ? 'clip' : 'clips'}`}
              {group.minutes > 0 && ` · ${String(group.minutes)} min`}
            </span>
          </div>
          <ul className="mac-library__grid">
            {group.items.map((clip) => (
              <MacClipTile
                key={clip.clip_id}
                clip={clip}
                isLive={live.has(clip.clip_id)}
                isSelected={selection.selected.includes(clip.clip_id)}
                onClick={(event) => {
                  selection.click(clip.clip_id, event);
                }}
                onContextMenu={(event) => {
                  onTileMenu(clip.clip_id, event);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

/** The right-click menu for the tiles it acts on (mock V4): one clip, or "Delete N clips…". */
function tileMenuItems(targets: readonly ClipSummary[], onMakeShort: (clipId: string) => void, onDelete: () => void): MenuEntry[] {
  const only = targets.length === 1 ? targets[0] : undefined;
  const remove: MenuEntry = {
    kind: 'item',
    label: only === undefined ? `Delete ${String(targets.length)} clips…` : 'Delete clip…',
    isDanger: true,
    onSelect: onDelete,
  };
  if (only === undefined) return [remove];
  return [
    {
      kind: 'item',
      label: 'Make a short from this clip',
      isDisabled: only.status !== 'ready' || only.segment_count === 0,
      onSelect: () => {
        onMakeShort(only.clip_id);
      },
    },
    { kind: 'separator' },
    remove,
  ];
}

/** The grid with its selection, right-click menu and delete sheet. */
function Grid({ clips, refresh }: { clips: ClipSummary[]; refresh: () => void }) {
  const selection = useTileSelection();
  const menu = useMenu();
  const makeShort = useMakeShortFromClip();
  const [menuIds, setMenuIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<DeleteTarget[]>([]);
  const targets = clips.filter((clip) => menuIds.includes(clip.clip_id));
  return (
    <>
      <Days
        clips={clips}
        selection={selection}
        onTileMenu={(clipId, event) => {
          setMenuIds(selection.targetsFor(clipId));
          menu.openAtPointer(event);
        }}
      />
      <Menu
        anchor={menu.anchor}
        label={targets.length > 1 ? `${String(targets.length)} clips` : 'Clip actions'}
        onClose={menu.close}
        items={tileMenuItems(targets, makeShort, () => {
          setDeleting(targets.map((clip) => ({ clipId: clip.clip_id, title: clip.title })));
        })}
      />
      <ClipDeleteSheet
        targets={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={(outcome) => {
          setDeleting([]);
          selection.forget(outcome.deleted);
          refresh();
        }}
      />
    </>
  );
}

function Body({ sync }: { sync: SyncStatus | null }) {
  const { state, refresh } = useClips();
  if (state.status === 'loading') {
    return (
      <div aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading your clips…
        </p>
        <ul className="mac-library__grid" aria-hidden="true">
          {['a', 'b', 'c', 'd', 'e'].map((key) => (
            <li key={key}>
              <Skeleton kind="thumb" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (state.status === 'error') return <LoadError error={state.error} thing="library" onRetry={refresh} />;
  if (state.data.length === 0) {
    return (
      <>
        <Tiles sync={sync} />
        <EmptyState
          icon="cloud"
          title="Your library is empty"
          body="Upload clips from your glasses. nimbytes watches every scene so you can find any moment later."
          action={
            <Link to="/upload" className={buttonClassName('primary', 'lg')}>
              <Icon name="plus" />
              Upload clips
            </Link>
          }
        />
      </>
    );
  }
  return (
    <>
      <Tiles sync={sync} />
      <Grid clips={state.data} refresh={refresh} />
    </>
  );
}

/**
 * The Mac Library.
 * @returns The page.
 */
export function MacLibraryPage() {
  const { state } = useSyncStatus();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const sync = state.status === 'ready' ? state.data : null;
  return (
    <div className="mac-library">
      <div className="mac-library__header">
        <h1 className="mac-library__title">Library</h1>
        <Link to="/search" className="mac-library__ask">
          <Icon name="search" size="md" />
          <span>Ask your footage anything…</span>
        </Link>
        <Link to="/upload" className={buttonClassName('primary')}>
          Upload
        </Link>
        <button
          type="button"
          className="mac-library__settings"
          aria-label="Settings and costs"
          onClick={() => {
            setSettingsOpen(true);
          }}
        >
          <Icon name="account" size="md" />
        </button>
      </div>
      <Body sync={sync} />
      <SettingsSheet
        open={isSettingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
