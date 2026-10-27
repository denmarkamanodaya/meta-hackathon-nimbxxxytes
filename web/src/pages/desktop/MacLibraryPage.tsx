// The Gallery in the Mac app (redesign v2, Gallery V1 grid and V2 list): the title and "5 clips ·
// 3.5 GB of 250 GB in the cloud", the uploading pill, the search field (⌘K) and the split Upload
// button (the native file or folder dialog, no Upload page); the storage warning when the account
// fills up; the toolbar (filter chips, sort, grid/list, size); the uploads, then the clips; and
// the right column for the selected clip. The Gallery is also the Mac app's search: a query (`/?q=`)
// replaces the toolbar and clips with its answer, and clearing it brings them back.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { GalleryClipPanel } from '../../components/desktop/ClipPanel';
import { GalleryClips } from '../../components/desktop/GalleryClips';
import { GalleryToolbar } from '../../components/desktop/GalleryToolbar';
import { UploadingPill, UploadSplitButton } from '../../components/desktop/GalleryUploads';
import { MacColumns } from '../../components/desktop/MacColumns';
import { ProjectSwatch } from '../../components/desktop/ProjectSwatch';
import { LoadError } from '../../components/LoadError';
import { SearchResults } from '../../components/SearchResults';
import { StorageNotice } from '../../components/StorageNotice';
import { NAV_COPY } from '../../core/copy';
import { galleryClips, galleryHeaderLine, type GalleryFilter, type GallerySort } from '../../core/gallery';
import type { GalleryUpload } from '../../core/gallery-uploads';
import { clipAvailability } from '../../core/on-this-mac';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { useClips } from '../../hooks/useClips';
import { useGalleryPrefs } from '../../hooks/useGalleryPrefs';
import { useStorageCap } from '../../hooks/useOverview';
import { useOnProjectsChanged, useProjects } from '../../hooks/useProjects';
import { useRecentQueries } from '../../hooks/useSearch';
import { useGalleryUploads, useSyncStatus } from '../../hooks/useDesktop';
import { useTileSelection } from '../../hooks/useTileSelection';
import type { ClipSummary } from '../../services/api/types';
import './MacLibraryPage.css';

/** The search field: Enter runs the query, the clear button goes back to the clips, ⌘K focuses it. */
function SearchField({ query, onRun, placeholder, isFocused }: { query: string; onRun: (next: string) => void; placeholder: string; isFocused: boolean }) {
  const [draft, setDraft] = useState(query);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <form
      className="mac-gallery__search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onRun(draft);
      }}
    >
      <Icon name="search" size="xs" />
      <input
        ref={input}
        className="mac-gallery__search-input"
        type="search"
        aria-keyshortcuts="Meta+K"
        aria-label="Search the gallery"
        placeholder={placeholder}
        autoFocus={isFocused}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
      />
      {draft === '' ? (
        <kbd className="mac-gallery__kbd">⌘K</kbd>
      ) : (
        <button
          type="button"
          className="mac-gallery__clear"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onRun('');
          }}
        >
          <Icon name="close" size="xs" />
        </button>
      )}
    </form>
  );
}

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

/** Props for `Clips`. */
interface ClipsProps {
  clips: ClipSummary[];
  refresh: () => void;
  onFocus: (clip: ClipSummary | null) => void;
  uploads: readonly GalleryUpload[];
  onCancelUpload: (transferId: string) => void;
}

/** The toolbar, the uploads and the clips, with the selection the right column follows. */
function Clips({ clips, refresh, onFocus, uploads, onCancelUpload }: ClipsProps) {
  const [prefs, setPrefs] = useGalleryPrefs();
  const [filter, setFilter] = useState<GalleryFilter>('all');
  const [sort, setSort] = useState<GallerySort>('newest');
  const { state } = useSyncStatus();
  const sync = state.status === 'ready' ? state.data : null;
  const selection = useTileSelection();
  const shown = useMemo(() => galleryClips(clips, filter, sort, (id) => clipAvailability(id, sync)), [clips, filter, sort, sync]);
  const focusedId = selection.selected.at(-1);
  const focused = shown.find((clip) => clip.clip_id === focusedId) ?? shown[0] ?? null;
  useEffect(() => {
    onFocus(focused);
  }, [focused, onFocus]);
  return (
    <>
      <GalleryToolbar
        filter={filter}
        onFilter={setFilter}
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
      <div className="mac-gallery__body">
        {shown.length === 0 && uploads.length === 0 ? (
          <EmptyState icon="cloud" title="Nothing here" body="No clip matches this filter right now." />
        ) : (
          <GalleryClips
            clips={shown}
            view={prefs.view}
            size={prefs.size}
            selection={selection}
            onDeleted={refresh}
            uploads={uploads}
            onCancelUpload={onCancelUpload}
          />
        )}
      </div>
    </>
  );
}

/**
 * The Mac Gallery.
 * @returns The page.
 */
export function MacLibraryPage() {
  const [params, setParams] = useSearchParams();
  const { record } = useRecentQueries();
  const { state, refresh } = useClips();
  const cap = useStorageCap();
  const upload = useGalleryUploads();
  const [focused, setFocused] = useState<ClipSummary | null>(null);
  useOnProjectsChanged(refresh);
  const query = params.get('q') ?? '';
  const projectId = params.get('project');
  const { state: projectState } = useProjects();
  const scope = projectId === null || projectState.status !== 'ready' ? null : (projectState.data.find((p) => p.project_id === projectId) ?? null);
  const run = (next: string) => {
    const clean = next.trim();
    if (clean !== '') record(clean);
    setParams({ ...(clean === '' ? {} : { q: clean }), ...(projectId === null ? {} : { project: projectId }) });
  };
  const all = state.status === 'ready' ? state.data : [];
  // "Search in this project": the clips and search answers kept to the project's clips.
  const clips = projectId === null ? all : all.filter((clip) => clip.project_ids.includes(projectId));
  // Uploads belong to no project yet, so a project-scoped Gallery leaves them out.
  const uploads = projectId === null ? upload.uploads : [];
  const live = focused === null ? null : (clips.find((clip) => clip.clip_id === focused.clip_id) ?? null);
  const aside =
    live === null ? (
      <p className="mac-gallery__no-clip">Pick a clip to see its moments, speech and faces.</p>
    ) : (
      <GalleryClipPanel key={live.clip_id} clip={live} />
    );
  return (
    <MacColumns asideLabel="Selected clip" aside={aside}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{NAV_COPY.gallery}</h1>
        {state.status === 'ready' && <span className="mac-columns__sub">{galleryHeaderLine(clips, cap?.ofCap ?? null)}</span>}
        {upload.line !== null && <UploadingPill line={upload.line} />}
        <span className="mac-columns__grow" />
        <SearchField
          key={`${query}|${projectId ?? ''}`}
          query={query}
          onRun={run}
          placeholder={scope === null ? 'Search moments, speech, faces' : `Search in ${scope.name}`}
          isFocused={projectId !== null && query === ''}
        />
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
      ) : clips.length === 0 && uploads.length === 0 ? (
        <div className="mac-gallery__body">
          <EmptyState
            icon="cloud"
            title="Your gallery is empty"
            body="Upload clips from your glasses. nimbytes watches every scene so you can find any moment later."
          />
        </div>
      ) : (
        <Clips clips={clips} refresh={refresh} onFocus={setFocused} uploads={uploads} onCancelUpload={upload.cancel} />
      )}
    </MacColumns>
  );
}
