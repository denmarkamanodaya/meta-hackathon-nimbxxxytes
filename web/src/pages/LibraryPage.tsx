// Library (P1): wordmark and settings; the dark "Ask your footage" bar with suggestion chips
// first; one storage line; a "getting ready" card for clips nimbytes still works on; then clips
// grouped by recording day in a 3-column grid. Polls
// GET /clips every 3 s; up to 3 processing clips follow their steps over SSE. "Select" in the
// header (or a long press on a clip) turns on Select mode: taps tick clips and the bar above the
// tab bar ("3 clips selected · Make a short · Cancel") makes a short from their pool. The Library
// also holds photos, iListen recordings and iRead documents (mocks GalleryMixedMock, PhotosMock):
// the "Uploading 12 photos" card, the kind row (All · Videos · Photos · Recordings · Documents,
// remembered) above the days, each kind in its day, a tap opening its own page, and in Select mode a Delete for any kind.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipSelectBar } from '../components/ClipSelectBar';
import { ClipTile } from '../components/ClipTile';
import { GalleryDeleteSheet } from '../components/GalleryDeleteSheet';
import { GalleryKindRow } from '../components/GalleryKindRow';
import { ItemTile } from '../components/ItemTile';
import { PhotoUploadCard } from '../components/PhotoUploadCard';
import { GettingReadyCard } from '../components/GettingReadyCard';
import { InstallHint } from '../components/InstallHint';
import { LoadError } from '../components/LoadError';
import { SettingsSheet } from '../components/SettingsSheet';
import { StorageCard } from '../components/StorageCard';
import { isInProgress, pickLiveClips } from '../core/clip-view';
import { groupByDay } from '../core/day-groups';
import { DEFAULT_GALLERY_SORT } from '../core/gallery';
import { datedItem, dayItemsLine, galleryItems, kindCounts, tickedClipIds, type GalleryItem } from '../core/gallery-items';
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
import { useDocuments } from '../hooks/useDocuments';
import { useGalleryPrefs } from '../hooks/useGalleryPrefs';
import { useListens } from '../hooks/useListens';
import { usePhotos } from '../hooks/usePhotos';
import type { ClipSummary } from '../services/api/types';
import './LibraryPage.css';

/** Most clips that hold a live SSE stream at once. */
const MAX_LIVE_STREAMS = 3;

function DayGroups({ clips, items, selection }: { clips: ClipSummary[]; items: readonly GalleryItem[]; selection: TileSelection }) {
  const live = useMemo(() => pickLiveClips(clips, MAX_LIVE_STREAMS), [clips]);
  const groups = useMemo(() => groupByDay(items.map(datedItem), new Date()), [items]);
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
              {group.items.every((each) => each.item.kind === 'video') ? (
                <>
                  {`${String(group.count)} ${group.count === 1 ? 'clip' : 'clips'}`}
                  {group.minutes > 0 && ` · ${String(group.minutes)} min`}
                </>
              ) : (
                dayItemsLine(group.items.map((each) => each.item))
              )}
            </span>
          </div>
          <ul className="library-page__grid">
            {group.items.map(({ item }) =>
              item.kind === 'video' ? (
                <ClipTile
                  key={item.id}
                  clip={item.clip}
                  isLive={live.has(item.id)}
                  isPicked={selection.isSelecting ? selection.selected.includes(item.id) : null}
                  onPick={() => {
                    toggle(item.id);
                  }}
                  onHold={() => {
                    hold(item.id);
                  }}
                />
              ) : (
                <ItemTile
                  key={item.id}
                  item={item}
                  isPicked={selection.isSelecting ? selection.selected.includes(item.id) : null}
                  onPick={() => {
                    toggle(item.id);
                  }}
                  onHold={() => {
                    hold(item.id);
                  }}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </>
  );
}

function LibraryBody({
  state,
  items,
  onRetry,
  selection,
}: {
  state: Polled<ClipSummary[]>;
  items: readonly GalleryItem[];
  onRetry: () => void;
  selection: TileSelection;
}) {
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
  if (state.data.length === 0 && items.length === 0) {
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
      <DayGroups clips={state.data} items={items} selection={selection} />
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
  const { state: photoState, refresh: refreshPhotos } = usePhotos();
  const { state: listenState, refresh: refreshListens } = useListens();
  const { state: documentState, refresh: refreshDocuments } = useDocuments();
  const photos = photoState.status === 'ready' ? photoState.data : [];
  const listens = listenState.status === 'ready' ? listenState.data : [];
  const documents = documentState.status === 'ready' ? documentState.data : [];
  const [prefs, setPrefs] = useGalleryPrefs();
  const sources = { clips, photos, listens, documents };
  const items = galleryItems(sources, prefs.kind, false, DEFAULT_GALLERY_SORT);
  const tickedIds = tickedClipIds(selection.selected);
  const [deleting, setDeleting] = useState<string[]>([]);

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
        {(clips.length > 0 || photos.length > 0 || listens.length > 0 || documents.length > 0) && (
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
      <PhotoUploadCard />
      {(photos.length > 0 || listens.length > 0 || documents.length > 0) && (
        <div className="library-page__kinds">
          <GalleryKindRow
            kind={prefs.kind}
            counts={kindCounts(sources)}
            onKind={(kind) => {
              setPrefs({ ...prefs, kind });
            }}
          />
        </div>
      )}
      <LibraryBody state={state} items={items} onRetry={refresh} selection={selection} />
      {selection.isSelecting && (
        <ClipSelectBar
          place="fixed"
          count={selection.selected.length}
          {...(tickedIds.length === selection.selected.length ? {} : { line: `${String(selection.selected.length)} selected` })}
          canMakeShort={hasMoments(clips.filter((clip) => tickedIds.includes(clip.clip_id)))}
          onMakeShort={() => {
            makeShort(tickedIds);
          }}
          onDelete={() => {
            setDeleting(selection.selected);
          }}
          onCancel={() => {
            selection.setSelecting(false);
          }}
        />
      )}
      <GalleryDeleteSheet
        itemIds={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={(outcome) => {
          setDeleting([]);
          selection.forget(outcome.deleted);
          refresh();
          refreshPhotos();
          refreshListens();
          refreshDocuments();
        }}
      />
      <SettingsSheet
        open={isSettingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}
