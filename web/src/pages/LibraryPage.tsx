// Library (P1): wordmark and settings; the dark "Ask your footage" bar with suggestion chips
// first; one storage line; a "getting ready" card for clips nimbytes still works on; then clips
// grouped by recording day in a 3-column grid. Polls
// GET /clips every 3 s; up to 3 processing clips follow their steps over SSE. "Select" in the
// header (or a long press on a clip) turns on Select mode: taps tick clips and the bar above the
// tab bar ("3 clips selected · Make a short · Cancel") makes a short from their pool.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipSelectBar } from '../components/ClipSelectBar';
import { ClipTile } from '../components/ClipTile';
import { GettingReadyCard } from '../components/GettingReadyCard';
import { InstallHint } from '../components/InstallHint';
import { LoadError } from '../components/LoadError';
import { SettingsSheet } from '../components/SettingsSheet';
import { StorageCard } from '../components/StorageCard';
import { isInProgress, pickLiveClips } from '../core/clip-view';
import { groupByDay } from '../core/day-groups';
import { suggestedQueries } from '../core/recent-queries';
import { hasMoments } from '../core/short-pool';
import { Button, buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { Wordmark } from '../design/Wordmark';
import { useClips, useMakeShortFromClips } from '../hooks/useClips';
import type { Polled } from '../hooks/usePolled';
import { PULL_TRIGGER_PX, usePullToRefresh } from '../hooks/usePullToRefresh';
import { useRecentQueries } from '../hooks/useSearch';
import { useTileSelection, type TileSelection } from '../hooks/useTileSelection';
import type { ClipSummary } from '../services/api/types';
import './LibraryPage.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

function DayGroups({ clips, selection }: { clips: ClipSummary[]; selection: TileSelection }) {
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const groups = useMemo(() => groupByDay(clips, new Date()), [clips]);
  const { hold, toggle } = selection;
  const working = useMemo(() => clips.filter((clip) => isInProgress(clip.status)), [clips]);
  return (
    <>
      <GettingReadyCard clips={working} live={live} />
      {groups.map((group) => (
        <section key={group.key} className="library-page__day" aria-label={group.label}>
          <div className="library-page__day-head">
            <h2 className="library-page__day-title">{group.label}</h2>
            <span className="library-page__day-meta">
              {`${String(group.count)} ${group.count === 1 ? 'clip' : 'clips'}`}
              {group.minutes > 0 && ` · ${String(group.minutes)} min`}
            </span>
          </div>
          <ul className="library-page__grid">
            {group.items.map((clip) => (
              <ClipTile
                key={clip.clip_id}
                clip={clip}
                isLive={live.has(clip.clip_id)}
                isPicked={selection.isSelecting ? selection.selected.includes(clip.clip_id) : null}
                onPick={() => {
                  toggle(clip.clip_id);
                }}
                onHold={() => {
                  hold(clip.clip_id);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function LibraryBody({ state, onRetry, selection }: { state: Polled<ClipSummary[]>; onRetry: () => void; selection: TileSelection }) {
  if (state.status === 'loading') {
    return (
      <div aria-busy="true" className="library-page__day">
        <p className="visually-hidden" role="status">
          Loading your clips…
        </p>
        <ul className="library-page__grid" aria-hidden="true">
          {['a', 'b', 'c'].map((key) => (
            <li key={key}>
              <Skeleton kind="thumb" />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (state.status === 'error') return <LoadError error={state.error} thing="library" onRetry={onRetry} />;
  if (state.data.length === 0) {
    return (
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
    );
  }
  return (
    <>
      {state.stale && (
        <div className="library-page__stale" role="status">
          <Chip tone="danger">Offline</Chip>
          <span>Showing your last loaded list.</span>
        </div>
      )}
      <DayGroups clips={state.data} selection={selection} />
    </>
  );
}

/**
 * The library.
 * @returns The page.
 */
export function LibraryPage() {
  const navigate = useNavigate();
  const { state, refresh } = useClips();
  const { recent } = useRecentQueries();
  const [isSettingsOpen, setSettingsOpen] = useState(false);
  const pull = usePullToRefresh(refresh);
  const selection = useTileSelection();
  const makeShort = useMakeShortFromClips();
  const clips = state.status === 'ready' ? state.data : [];

  return (
    <div className="library-page">
      <div className="library-page__pull" style={{ height: `${String(pull)}px` }} aria-hidden="true">
        {pull > 0 && <Spinner />}
        {pull >= PULL_TRIGGER_PX && <span>Release to refresh</span>}
      </div>
      <header className="library-page__header">
        <h1 className="library-page__brand">
          <Wordmark />
        </h1>
        <span className="library-page__grow" />
        {clips.length > 0 && (
          <Button
            variant="ghost"
            aria-pressed={selection.isSelecting}
            onClick={() => {
              selection.setSelecting(!selection.isSelecting);
            }}
          >
            {selection.isSelecting ? 'Done' : 'Select'}
          </Button>
        )}
        <button
          type="button"
          className="library-page__account"
          aria-label="Settings"
          onClick={() => {
            setSettingsOpen(true);
          }}
        >
          <Icon name="account" size="md" />
        </button>
      </header>
      <InstallHint />
      <Link to="/search" className="library-page__ask">
        <Icon name="search" size="md" />
        <span>Ask your footage anything…</span>
      </Link>
      <div className="library-page__chips">
        {suggestedQueries(recent).map((query) => (
          <Chip
            key={query}
            onClick={() => {
              void navigate(`/search?q=${encodeURIComponent(query)}`);
            }}
          >
            {query}
          </Chip>
        ))}
      </div>
      <StorageCard />
      <LibraryBody state={state} onRetry={refresh} selection={selection} />
      {selection.isSelecting && (
        <ClipSelectBar
          place="fixed"
          count={selection.selected.length}
          canMakeShort={hasMoments(clips.filter((clip) => selection.selected.includes(clip.clip_id)))}
          onMakeShort={() => {
            makeShort(selection.selected);
          }}
          onCancel={() => {
            selection.setSelecting(false);
          }}
        />
      )}
      <SettingsSheet
        open={isSettingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
