// Library in the Mac app (mock M1): the title, the dark "Ask your footage anything…" bar and
// Upload in one row; three storage tiles (in your cloud, on this Mac, originals offline); then
// clips by recording day in a 5-column grid with where each one is on this Mac.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MacClipTile } from '../../components/desktop/MacClipTile';
import { LoadError } from '../../components/LoadError';
import { SettingsSheet } from '../../components/SettingsSheet';
import { pickLiveClips } from '../../core/clip-view';
import { groupByDay } from '../../core/day-groups';
import { clipDiskState, storageTiles, type SyncStatus } from '../../core/desktop-sync';
import { buttonClassName } from '../../design/Button';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { useClips } from '../../hooks/useClips';
import { useSyncStatus } from '../../hooks/useDesktop';
import { useStorage } from '../../hooks/useOverview';
import type { ClipSummary } from '../../services/api/types';
import './MacLibraryPage.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

function Tiles({ clips, sync }: { clips: readonly ClipSummary[]; sync: SyncStatus | null }) {
  const storage = useStorage();
  const cloud = storage.status === 'ready' ? { bytes: storage.data.cloud_bytes, clips: storage.data.clip_count } : null;
  const ready = clips.filter((clip) => clip.status === 'ready').map((clip) => clip.clip_id);
  return (
    <section className="mac-library__tiles" aria-label="Storage">
      {storageTiles(cloud, sync, ready).map((tile) => (
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

function Days({ clips, sync }: { clips: ClipSummary[]; sync: SyncStatus | null }) {
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
                disk={clipDiskState(clip.clip_id, sync)}
                isLive={live.has(clip.clip_id)}
              />
            ))}
          </ul>
        </section>
      ))}
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
        <Tiles clips={[]} sync={sync} />
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
      <Tiles clips={state.data} sync={sync} />
      <Days clips={state.data} sync={sync} />
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
