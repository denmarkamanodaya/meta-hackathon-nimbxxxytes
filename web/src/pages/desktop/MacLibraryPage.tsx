// The Gallery in the Mac app (redesign v2, Gallery V1 grid and V2 list): the title and "5 clips ·
// 3.5 GB of 250 GB in the cloud", the uploading pill and the split Upload button (the native file
// or folder dialog, no Upload page); the storage warning when the account fills up; the toolbar
// (filter chips, sort, grid/list, size); the uploads, then the clips; and the right column for the
// selected clip. The Copies chip (Phase 29 V54) lists duplicates and near-copies, heads the page
// "3 copies of other clips" and offers "Remove all copies…". The Gallery also shows the universal search bar's full answer: a query (`/?q=`,
// sent by the bar's "See all" or ⌘⏎) replaces the toolbar and clips with its results, and the
// results line's clear button brings them back. The bar is the only search box (no header field).
// "Select" in the header turns on Select mode: clicks tick clips, Shift-click ticks a range, and
// the bar at the foot ("3 clips selected · Add to project · Make a short · Cancel") puts them in a
// project (or a new one) or makes a short from their pool. The list's headers sort the clips.
// The Gallery also holds iListen recordings and iRead documents (mock GalleryMixedMock): the kind
// row (All · Videos · Recordings · Documents, remembered) above the toolbar, one grid newest first,
// the header's counts of each kind, their own right column, and in Select mode a Delete for any kind
// (projects and Make a short stay with the clips). Faces, Shorts and search stay video-only.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { GalleryClipPanel } from '../../components/desktop/ClipPanel';
import { GalleryDocumentPanel, GalleryRecordingPanel } from '../../components/desktop/GalleryItemPanel';
import { GalleryDeleteSheet } from '../../components/GalleryDeleteSheet';
import { GalleryKindRow } from '../../components/GalleryKindRow';
import { GalleryClips } from '../../components/desktop/GalleryClips';
import { GalleryToolbar } from '../../components/desktop/GalleryToolbar';
import { UploadingPill, UploadSplitButton } from '../../components/desktop/GalleryUploads';
import { MacColumns } from '../../components/desktop/MacColumns';
import { MacConfirmDialog } from '../../components/desktop/MacConfirmDialog';
import { NewProjectSheet } from '../../components/desktop/NewProjectSheet';
import { addToProjectItems } from '../../components/desktop/project-menu';
import { ProjectSwatch } from '../../components/desktop/ProjectSwatch';
import { ClipSelectBar } from '../../components/ClipSelectBar';
import { LoadError } from '../../components/LoadError';
import { SearchResults } from '../../components/SearchResults';
import { StorageNotice } from '../../components/StorageNotice';
import { NAV_COPY } from '../../core/copy';
import { DEFAULT_GALLERY_SORT, galleryClips, galleryHeaderLine, type GalleryFilter, type GalleryPrefs, type GallerySort } from '../../core/gallery';
import { galleryItems, kindCounts, otherCountParts, tickedClipIds, type GalleryItem } from '../../core/gallery-items';
import type { GalleryUpload } from '../../core/gallery-uploads';
import { clipAvailability } from '../../core/on-this-mac';
import { hasMoments } from '../../core/short-pool';
import { copiesHeadLine, copiesIn, copiesSizeLine, removeCopiesCopy, removingLabel, SIMILAR_COPY } from '../../core/similar';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { useClips, useMakeShortFromClips } from '../../hooks/useClips';
import { useGalleryPrefs } from '../../hooks/useGalleryPrefs';
import { useStorageCap } from '../../hooks/useOverview';
import { useMenu } from '../../hooks/useMenu';
import { useOnProjectsChanged, useProjectActions, useProjects } from '../../hooks/useProjects';
import { useGalleryUploads, useSyncStatus } from '../../hooks/useDesktop';
import { useTileSelection, type TileSelection } from '../../hooks/useTileSelection';
import { useRemoveCopies } from '../../hooks/useSimilar';
import { useDocuments } from '../../hooks/useDocuments';
import { useListens } from '../../hooks/useListens';
import type { ClipSummary, DocumentSummary, ListenSummary } from '../../services/api/types';
import './MacLibraryPage.css';

const NONE_LISTENS: readonly ListenSummary[] = [];
const NONE_DOCUMENTS: readonly DocumentSummary[] = [];

function Loading() {
  return (
    <div className="mac-gallery__body" aria-busy="true">
      <p className="visually-hidden" role="status">
        Loading your clips…
      </p>
      <ul className="gallery-grid mac-gallery__skeleton" aria-hidden="true">
        {['a', 'b', 'c', 'd', 'e'].map((key) => (
          <li key={key}>
            <Skeleton kind="thumb" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Copies view's strip (Phase 29 V54): "3 copies use 1.8 GB. Removing them keeps the
 * originals." and "Remove all copies…", which asks first and then removes them one at a time.
 * @param props - The copies and what to reload after.
 * @returns The strip and its confirm.
 */
function CopiesStrip({ copies, onRemoved }: { copies: readonly ClipSummary[]; onRemoved: () => void }) {
  const removal = useRemoveCopies();
  const [isConfirming, setConfirming] = useState(false);
  if (copies.length === 0) return null;
  return (
    <div className="mac-gallery__copies">
      <span className="mac-gallery__copies-line">{copiesSizeLine(copies)}</span>
      <button
        type="button"
        className="mac-button"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {SIMILAR_COPY.removeAll}
      </button>
      <MacConfirmDialog
        open={isConfirming}
        copy={removeCopiesCopy(copies.length)}
        isBusy={removal.progress !== null}
        {...(removal.progress === null ? {} : { busyLabel: removingLabel(removal.progress) })}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void removal.remove(copies.map((clip) => clip.clip_id)).then(() => {
            setConfirming(false);
            onRemoved();
          });
        }}
      />
    </div>
  );
}

/** Props for `Clips`. */
interface ClipsProps {
  clips: ClipSummary[];
  /** The Gallery's recordings and documents (none in a project-scoped Gallery). */
  listens: readonly ListenSummary[];
  documents: readonly DocumentSummary[];
  prefs: GalleryPrefs;
  setPrefs: (next: GalleryPrefs) => void;
  filter: GalleryFilter;
  onFilter: (next: GalleryFilter) => void;
  refresh: () => void;
  onFocus: (item: GalleryItem | null) => void;
  uploads: readonly GalleryUpload[];
  onCancelUpload: (transferId: string) => void;
  /** The Gallery's selection; the header's Select button turns its Select mode on. */
  selection: TileSelection;
}

/** The toolbar, the uploads and the clips, with the selection the right column follows. */
function Clips({ clips, listens, documents, prefs, setPrefs, filter, onFilter, refresh, onFocus, uploads, onCancelUpload, selection }: ClipsProps) {
  const [sort, setSort] = useState<GallerySort>(DEFAULT_GALLERY_SORT);
  const { state } = useSyncStatus();
  const sync = state.status === 'ready' ? state.data : null;
  const makeShort = useMakeShortFromClips();
  const { state: projectState } = useProjects();
  const projects = useMemo(() => (projectState.status === 'ready' ? projectState.data : []), [projectState]);
  const projectActions = useProjectActions();
  const projectMenu = useMenu();
  const [newFor, setNewFor] = useState<string[] | null>(null);
  const shown = useMemo(() => galleryClips(clips, filter, sort, (id) => clipAvailability(id, sync), projects), [clips, filter, sort, sync, projects]);
  const items = useMemo(() => galleryItems({ clips: shown, listens, documents }, prefs.kind, filter !== 'all', sort), [shown, listens, documents, prefs.kind, filter, sort]);
  const counts = kindCounts({ clips, listens, documents });
  const tickedIds = tickedClipIds(selection.selected);
  const ticked = clips.filter((clip) => tickedIds.includes(clip.clip_id));
  const [deleting, setDeleting] = useState<string[]>([]);
  const copies = useMemo(() => copiesIn(clips), [clips]);
  const focusedId = selection.selected.at(-1);
  const focused = items.find((item) => item.id === focusedId) ?? items[0] ?? null;
  const hasVideosOnly = prefs.kind === 'all' || prefs.kind === 'videos';
  useEffect(() => {
    onFocus(focused);
  }, [focused, onFocus]);
  return (
    <>
      {(listens.length > 0 || documents.length > 0) && (
        <div className="mac-gallery__kinds">
          <GalleryKindRow
            kind={prefs.kind}
            counts={counts}
            onKind={(kind) => {
              setPrefs({ ...prefs, kind });
            }}
          />
        </div>
      )}
      <GalleryToolbar
        filter={filter}
        onFilter={onFilter}
        copies={copies.length}
        sort={sort}
        onSort={setSort}
        view={prefs.view}
        onView={(view) => {
          setPrefs({ ...prefs, view });
        }}
        size={prefs.size}
        onSize={(size) => {
          setPrefs({ ...prefs, size });
        }}
      />
      {filter === 'copies' && <CopiesStrip copies={copies} onRemoved={refresh} />}
      <div className="mac-gallery__body">
        {items.length === 0 && (uploads.length === 0 || !hasVideosOnly) ? (
          <EmptyState icon="cloud" title="Nothing here" body="Nothing matches this filter right now." />
        ) : (
          <GalleryClips
            clips={shown}
            items={items}
            view={prefs.view}
            size={prefs.size}
            selection={selection}
            onDeleted={refresh}
            uploads={hasVideosOnly ? uploads : []}
            onCancelUpload={onCancelUpload}
            sort={sort}
            onSort={setSort}
          />
        )}
      </div>
      {selection.isSelecting && (
        <ClipSelectBar
          place="column"
          count={selection.selected.length}
          {...(tickedIds.length === selection.selected.length ? {} : { line: `${String(selection.selected.length)} selected` })}
          canMakeShort={hasMoments(ticked)}
          onMakeShort={() => {
            makeShort(tickedIds);
          }}
          onAddToProject={projectMenu.openFromButton}
          isAddOff={tickedIds.length === 0}
          onDelete={() => {
            setDeleting(selection.selected);
          }}
          onCancel={() => {
            selection.setSelecting(false);
          }}
        />
      )}
      <Menu
        anchor={projectMenu.anchor}
        label="Add to project"
        onClose={projectMenu.close}
        items={addToProjectItems(projects, ticked, projectActions.toggle, () => {
          setNewFor(tickedIds);
        })}
      />
      <GalleryDeleteSheet
        itemIds={deleting}
        onCancel={() => {
          setDeleting([]);
        }}
        onDone={(outcome) => {
          setDeleting([]);
          selection.forget(outcome.deleted);
          refresh();
        }}
      />
      <NewProjectSheet
        open={newFor !== null}
        clipIds={newFor ?? []}
        onClose={() => {
          setNewFor(null);
        }}
      />
    </>
  );
}

/**
 * The Mac Gallery.
 * @returns The page.
 */
export function MacLibraryPage() {
  const [params, setParams] = useSearchParams();
  const { state, refresh } = useClips();
  const cap = useStorageCap();
  const upload = useGalleryUploads();
  const [focused, setFocused] = useState<GalleryItem | null>(null);
  const [prefs, setPrefs] = useGalleryPrefs();
  const { state: listenState, refresh: refreshListens } = useListens();
  const { state: documentState, refresh: refreshDocuments } = useDocuments();
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const selection = useTileSelection();
  useOnProjectsChanged(refresh);
  const query = params.get('q') ?? '';
  const projectId = params.get('project');
  const { state: projectState } = useProjects();
  const scope = projectId === null || projectState.status !== 'ready' ? null : (projectState.data.find((p) => p.project_id === projectId) ?? null);
  const all = state.status === 'ready' ? state.data : [];
  // "Search in this project": the clips and search answers kept to the project's clips.
  const clips = projectId === null ? all : all.filter((clip) => clip.project_ids.includes(projectId));
  // Uploads belong to no project yet, so a project-scoped Gallery leaves them out.
  const uploads = projectId === null ? upload.uploads : [];
  // Recordings and documents belong to no project, so a project-scoped Gallery leaves them out.
  const listens = projectId === null && listenState.status === 'ready' ? listenState.data : NONE_LISTENS;
  const documents = projectId === null && documentState.status === 'ready' ? documentState.data : NONE_DOCUMENTS;
  const refreshAll = useCallback(() => {
    refresh();
    refreshListens();
    refreshDocuments();
  }, [refresh, refreshListens, refreshDocuments]);
  const live = focused?.kind === 'video' ? (clips.find((clip) => clip.clip_id === focused.id) ?? null) : null;
  const aside =
    focused?.kind === 'recording' ? (
      <GalleryRecordingPanel key={focused.id} summary={focused.listen} onChanged={refreshAll} />
    ) : focused?.kind === 'document' ? (
      <GalleryDocumentPanel key={focused.id} summary={focused.doc} onChanged={refreshAll} />
    ) : live === null ? (
      <p className="mac-gallery__no-clip">Pick a clip to see its moments, speech and faces.</p>
    ) : (
      <GalleryClipPanel key={live.clip_id} clip={live} onChanged={refresh} />
    );
  const others = otherCountParts(kindCounts({ clips, listens, documents }));
  return (
    <MacColumns asideLabel="Selected clip" aside={aside}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{NAV_COPY.gallery}</h1>
        {state.status === 'ready' && (
          <span className="mac-columns__sub">
            {query === '' && filter === 'copies' ? copiesHeadLine(copiesIn(clips).length) : galleryHeaderLine(clips, cap?.ofCap ?? null, others)}
          </span>
        )}
        {upload.line !== null && <UploadingPill line={upload.line} />}
        <span className="mac-columns__grow" />
        {query === '' && (clips.length > 0 || listens.length > 0 || documents.length > 0) && (
          <button
            type="button"
            className="mac-button"
            aria-pressed={selection.isSelecting}
            onClick={() => {
              selection.setSelecting(!selection.isSelecting);
            }}
          >
            {selection.isSelecting ? 'Done' : 'Select'}
          </button>
        )}
        <UploadSplitButton cap={cap} />
      </header>
      {cap?.notice != null && (
        <div className="mac-gallery__notice">
          <StorageNotice cap={cap} />
        </div>
      )}
      {scope !== null && (
        <div className="mac-gallery__scope">
          Searching in
          <ProjectSwatch color={scope.color} />
          <span className="mac-gallery__scope-name">{scope.name}</span>
          <button
            type="button"
            className="mac-gallery__clear"
            aria-label="Search the whole gallery"
            onClick={() => {
              setParams(query === '' ? {} : { q: query });
            }}
          >
            <Icon name="close" size="xs" />
          </button>
        </div>
      )}
      {query !== '' && (
        <div className="mac-gallery__scope">
          Results for
          <span className="mac-gallery__scope-name">{`“${query}”`}</span>
          <button
            type="button"
            className="mac-gallery__clear"
            aria-label="Clear search"
            onClick={() => {
              setParams(projectId === null ? {} : { project: projectId });
            }}
          >
            <Icon name="close" size="xs" />
          </button>
        </div>
      )}
      {query !== '' ? (
        <div className="mac-gallery__body">
          <SearchResults key={query} query={query} {...(projectId === null ? {} : { clipIds: clips.map((clip) => clip.clip_id) })} />
        </div>
      ) : state.status === 'loading' ? (
        <Loading />
      ) : state.status === 'error' ? (
        <div className="mac-gallery__body">
          <LoadError error={state.error} thing="gallery" onRetry={refresh} />
        </div>
      ) : clips.length === 0 && uploads.length === 0 && listens.length === 0 && documents.length === 0 ? (
        <div className="mac-gallery__body">
          <EmptyState
            icon="cloud"
            title="Your gallery is empty"
            body="Upload clips from your glasses. nimbytes watches every scene so you can find any moment later."
          />
        </div>
      ) : (
        <Clips
          clips={clips}
          listens={listens}
          documents={documents}
          prefs={prefs}
          setPrefs={setPrefs}
          filter={filter} onFilter={setFilter} refresh={refreshAll} onFocus={setFocused} uploads={uploads} onCancelUpload={upload.cancel} selection={selection} />
      )}
    </MacColumns>
  );
}
