// Library page: a grid of the user's clips with live status (polls GET /clips every 3 s and
// follows up to 3 processing clips over SSE). Pull down to refresh at once.
import { useMemo } from 'react';
import { Link } from 'react-router';
import { ClipCard } from '../components/ClipCard';
import { HealthChip } from '../components/HealthChip';
import { pickLiveClips } from '../core/clip-view';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Spinner } from '../design/Spinner';
import { useClips } from '../hooks/useClips';
import type { Polled } from '../hooks/usePolled';
import { PULL_TRIGGER_PX, usePullToRefresh } from '../hooks/usePullToRefresh';
import type { ClipSummary } from '../services/api/types';
import './LibraryPage.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

function ClipGrid({ clips }: { clips: ClipSummary[] }) {
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const now = useMemo(() => new Date(), []);
  return (
    <ul className="library-page__grid">
      {clips.map((clip) => (
        <ClipCard key={clip.clip_id} clip={clip} isLive={live.has(clip.clip_id)} now={now} />
      ))}
    </ul>
  );
}

function LibraryBody({ state }: { state: Polled<ClipSummary[]> }) {
  if (state.status === 'loading') {
    return (
      <p className="library-page__note" role="status">
        <Spinner /> Loading your clips…
      </p>
    );
  }
  if (state.status === 'error') {
    return <EmptyState icon="cloud" title="Could not load your clips" body={state.message} />;
  }
  if (state.data.length === 0) {
    return (
      <EmptyState
        icon="cloud"
        title="Your library is empty"
        body="Upload clips from your glasses. nimbytes watches every scene so you can find any moment later."
        action={
          <Link to="/upload" className={buttonClassName('primary')}>
            <Icon name="upload" />
            Upload clips
          </Link>
        }
      />
    );
  }
  return (
    <>
      {state.stale && (
        <div className="library-page__stale" role="status">
          <Chip tone="danger">Offline</Chip>
          <span className="library-page__note">Showing your last loaded list.</span>
        </div>
      )}
      <ClipGrid clips={state.data} />
    </>
  );
}

/**
 * Lists the user's clips; until the first upload, explains what the library does.
 * @returns The page.
 */
export function LibraryPage() {
  const { state, refresh } = useClips();
  const pull = usePullToRefresh(refresh);
  const count = state.status === 'ready' && state.data.length > 0 ? state.data.length : null;

  return (
    <>
      <div className="library-page__pull" style={{ height: `${String(pull)}px` }} aria-hidden="true">
        {pull > 0 && <Spinner />}
        {pull >= PULL_TRIGGER_PX && <span>Release to refresh</span>}
      </div>
      <PageHeader
        eyebrow={
          <>
            <Icon name="cloud" />
            nimbytes
          </>
        }
        title="Library"
        trailing={<HealthChip />}
      />
      {count !== null && (
        <p className="library-page__count">{`${String(count)} ${count === 1 ? 'clip' : 'clips'}`}</p>
      )}
      <LibraryBody state={state} />
    </>
  );
}
