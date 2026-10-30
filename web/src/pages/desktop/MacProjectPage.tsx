// A segment in the Mac app (a project, shown as a segment; redesign v2, Projects board V4, key art
// V16): the header with the segment's colour, "Segment · 3 clips · 2 recordings · 1 photo · 3.4 GB",
// Add clips and the options menu (colour, delete); the key art banner (New art, Download) and the
// moments it was drawn from; the note that everything stays in the Gallery, the grid/list switch,
// its clips, photos, recordings and documents (the lists merged by their project ids) with a "Drag
// items here" box; and the right column "About this segment" with Make a short from this segment,
// Make all available offline and Search in this segment (the Gallery kept to the segment).
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AddClipsSheet } from '../../components/desktop/AddClipsSheet';
import { useClipDrop } from '../../components/desktop/clip-drag';
import { GalleryClips } from '../../components/desktop/GalleryClips';
import { ViewSwitch } from '../../components/desktop/GalleryToolbar';
import { MacColumns } from '../../components/desktop/MacColumns';
import { ProjectKeyArt } from '../../components/desktop/ProjectKeyArt';
import { ProjectSwatch, projectColorClass } from '../../components/desktop/ProjectSwatch';
import { RenameProjectSheet } from '../../components/desktop/RenameProjectSheet';
import { LoadError } from '../../components/LoadError';
import { SEGMENT_COPY } from '../../core/copy';
import { projectItems } from '../../core/gallery-items';
import { projectFacts, projectHeaderLine, PROJECT_COLOR_LABEL } from '../../core/projects';
import { ConfirmSheet } from '../../design/ConfirmSheet';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { useMakeShortFromClips } from '../../hooks/useClips';
import { useIsMacApp, useKeepOffline, useSyncStatus } from '../../hooks/useDesktop';
import { useGalleryPrefs } from '../../hooks/useGalleryPrefs';
import { useMenu } from '../../hooks/useMenu';
import { useDocuments } from '../../hooks/useDocuments';
import { useListens } from '../../hooks/useListens';
import { usePhotos } from '../../hooks/usePhotos';
import { useOnProjectsChanged, useProjectActions, useProjectClips, useProjects, useShortsMade } from '../../hooks/useProjects';
import { useTileSelection } from '../../hooks/useTileSelection';
import { PROJECT_COLORS, type ClipSummary, type Project } from '../../services/api/types';
import './MacLibraryPage.css';
import './MacProjectPage.css';

/** The "Drag items here" cell: takes a drop of Gallery entries of any kind, or opens Add clips on a click. */
function DropBox({ project, onPick }: { project: Project; onPick: () => void }) {
  const { addItems } = useProjectActions();
  const drop = useClipDrop((itemIds) => {
    void addItems(project.project_id, itemIds);
  });
  return (
    <button type="button" className={drop.isOver ? 'project-page__drop project-page__drop--over' : 'project-page__drop'} onClick={onPick} {...drop.handlers}>
      <Icon name="plus" size="md" />
      {SEGMENT_COPY.dropHere}
    </button>
  );
}

/** "About this segment": its facts and the segment-wide actions. */
function About({ project, clips }: { project: Project; clips: readonly ClipSummary[] }) {
  const { state } = useSyncStatus();
  const keep = useKeepOffline();
  const isMacApp = useIsMacApp();
  const makeShort = useMakeShortFromClips();
  const navigate = useNavigate();
  const shortsMade = useShortsMade(clips.map((clip) => clip.clip_id));
  const sync = state.status === 'ready' ? state.data : null;
  const ids = new Set(clips.map((clip) => clip.clip_id));
  const cached = sync?.local.clips.filter((row) => ids.has(row.clipId)).reduce((sum, row) => sum + row.cachedBytes, 0) ?? 0;
  const facts = projectFacts(project, clips, cached);
  const withMoments = clips.filter((clip) => clip.status === 'ready' && clip.segment_count > 0);
  const notKept = clips.filter((clip) => clip.status === 'ready' && !(sync?.pinnedClipIds.includes(clip.clip_id) ?? false));
  return (
    <div className="project-about">
      <h2 className="project-about__title">{SEGMENT_COPY.about}</h2>
      <dl className="project-about__facts">
        <dt>Clips</dt>
        <dd>{facts.clips}</dd>
        <dt>Moments</dt>
        <dd>{facts.moments}</dd>
        <dt>Faces</dt>
        <dd>{facts.faces}</dd>
        <dt>On this Mac</dt>
        <dd>{facts.onThisMac}</dd>
        <dt>Shorts made</dt>
        <dd>{shortsMade === null ? '—' : String(shortsMade)}</dd>
      </dl>
      <span className="mac-columns__grow" />
      <button
        type="button"
        className="mac-button mac-button--primary"
        disabled={withMoments.length === 0}
        onClick={() => {
          makeShort(withMoments.map((clip) => clip.clip_id));
        }}
      >
        {SEGMENT_COPY.makeShort}
      </button>
      {isMacApp && (
        <button
          type="button"
          className="mac-button"
          disabled={notKept.length === 0}
          onClick={() => {
            for (const clip of notKept) keep(clip.clip_id, true);
          }}
        >
          Make all available offline
        </button>
      )}
      <button
        type="button"
        className="mac-button"
        onClick={() => {
          void navigate(`/?project=${encodeURIComponent(project.project_id)}`);
        }}
      >
        {SEGMENT_COPY.searchIn}
      </button>
    </div>
  );
}

/** The header's ⋯ menu: Rename…, the six colours and Delete project…. */
function Options({ project }: { project: Project }) {
  const menu = useMenu();
  const actions = useProjectActions();
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const [isRenaming, setRenaming] = useState(false);
  return (
    <>
      <button type="button" className="mac-button mac-button--icon" aria-label={SEGMENT_COPY.options} aria-haspopup="menu" onClick={menu.openFromButton}>
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label={SEGMENT_COPY.options}
        onClose={menu.close}
        items={[
          {
            kind: 'item',
            label: 'Rename…',
            onSelect: () => {
              setRenaming(true);
            },
          },
          {
            kind: 'submenu',
            label: 'Colour',
            items: PROJECT_COLORS.map((color) => ({
              kind: 'check',
              label: PROJECT_COLOR_LABEL[color],
              isChecked: color === project.color,
              swatchClass: projectColorClass(color),
              onSelect: () => {
                void actions.update(project.project_id, { color });
              },
            })),
          },
          { kind: 'separator' },
          {
            kind: 'item',
            label: SEGMENT_COPY.deleteMenu,
            isDanger: true,
            onSelect: () => {
              setDeleting(true);
            },
          },
        ]}
      />
      <RenameProjectSheet
        open={isRenaming}
        project={project}
        onClose={() => {
          setRenaming(false);
        }}
      />
      <ConfirmSheet
        open={isDeleting}
        title={`Delete “${project.name}”?`}
        body={SEGMENT_COPY.deleteBody}
        confirmLabel={SEGMENT_COPY.deleteSegment}
        busyLabel="Deleting…"
        isBusy={actions.isSaving}
        onCancel={() => {
          setDeleting(false);
        }}
        onConfirm={() => {
          void actions.remove(project.project_id).then((isDone) => {
            setDeleting(false);
            if (isDone) void navigate('/');
          });
        }}
      />
    </>
  );
}

function Clips({ project }: { project: Project }) {
  const { state, refresh } = useProjectClips(project.project_id);
  const { state: photoState, refresh: refreshPhotos } = usePhotos();
  const { state: listenState, refresh: refreshListens } = useListens();
  const { state: documentState, refresh: refreshDocuments } = useDocuments();
  const [prefs, setPrefs] = useGalleryPrefs();
  const selection = useTileSelection();
  const [isAdding, setAdding] = useState(false);
  const clips = useMemo(() => (state.status === 'ready' ? state.data : []), [state]);
  const items = useMemo(
    () =>
      projectItems(project.project_id, {
        clips,
        photos: photoState.status === 'ready' ? photoState.data : [],
        listens: listenState.status === 'ready' ? listenState.data : [],
        documents: documentState.status === 'ready' ? documentState.data : [],
      }),
    [project.project_id, clips, photoState, listenState, documentState],
  );
  const refreshOthers = useCallback(() => {
    refreshPhotos();
    refreshListens();
    refreshDocuments();
  }, [refreshPhotos, refreshListens, refreshDocuments]);
  useOnProjectsChanged(refreshOthers);
  const openAdd = () => {
    setAdding(true);
  };
  const body =
    state.status === 'loading' ? (
      <Skeleton kind="thumb" />
    ) : state.status === 'error' ? (
      <LoadError error={state.error} thing="segment" onRetry={refresh} />
    ) : (
      <>
        <GalleryClips
          clips={clips}
          items={items}
          view={prefs.view}
          size={prefs.size}
          selection={selection}
          projectId={project.project_id}
          onDeleted={() => {
            refresh();
            refreshOthers();
          }}
          extraTile={prefs.view === 'grid' ? <DropBox project={project} onPick={openAdd} /> : undefined}
        />
        {prefs.view === 'list' && (
          <div className="project-page__list-drop">
            <DropBox project={project} onPick={openAdd} />
          </div>
        )}
      </>
    );
  return (
    <MacColumns asideLabel={SEGMENT_COPY.segment} aside={<About project={project} clips={clips} />}>
      <header className="mac-columns__head project-page__head">
        <ProjectSwatch color={project.color} isLarge />
        <h1 className="mac-columns__title">{project.name}</h1>
        <span className="mac-columns__sub">{projectHeaderLine(project)}</span>
        <span className="mac-columns__grow" />
        <button type="button" className="mac-button" onClick={openAdd}>
          <Icon name="plus" size="xs" />
          Add clips
        </button>
        <Options project={project} />
      </header>
      <ProjectKeyArt project={project} />
      <div className="project-page__bar">
        <span className="mac-columns__sub">{SEGMENT_COPY.stayNote}</span>
        <span className="mac-columns__grow" />
        <ViewSwitch
          view={prefs.view}
          onView={(view) => {
            setPrefs({ ...prefs, view });
          }}
        />
      </div>
      <div className="mac-gallery__body project-page__body">{body}</div>
      <AddClipsSheet
        open={isAdding}
        project={project}
        onClose={() => {
          setAdding(false);
          refresh();
        }}
      />
    </MacColumns>
  );
}

/**
 * The segment page (`/projects/:id`).
 * @returns The page.
 */
export function MacProjectPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useProjects();
  if (state.status === 'loading') return <Skeleton kind="line" />;
  if (state.status === 'error') return <LoadError error={state.error} thing="segments" onRetry={refresh} />;
  const project = state.data.find((p) => p.project_id === id);
  if (project === undefined) {
    return (
      <EmptyState
        icon="cloud"
        title={SEGMENT_COPY.gone}
        body={SEGMENT_COPY.goneBody}
        action={
          <Link to="/" className="mac-button">
            Open the Gallery
          </Link>
        }
      />
    );
  }
  return <Clips key={project.project_id} project={project} />;
}
