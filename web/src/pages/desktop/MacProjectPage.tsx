// A project in the Mac app (redesign v2, Projects board V4, key art V16): the header with the
// project's colour, "Project · 1 clip · 3.4 GB", Add clips and the options menu (colour, delete);
// the key art banner (New art, Download) and the moments it was drawn from; the note that clips
// stay in the Gallery, the grid/list switch, the clips with a "Drag clips here" box; and the right
// column "About this project" with Make a short from this project, Make all available offline and
// Search in this project (the Gallery's search kept to the project's clips).
import { useState } from 'react';
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
import { useProjectActions, useProjectClips, useProjects, useShortsMade } from '../../hooks/useProjects';
import { useTileSelection } from '../../hooks/useTileSelection';
import { PROJECT_COLORS, type ClipSummary, type Project } from '../../services/api/types';
import './MacLibraryPage.css';
import './MacProjectPage.css';

/** The "Drag clips here" cell: takes a drop of Gallery clips, or opens Add clips on a click. */
function DropBox({ project, onPick }: { project: Project; onPick: () => void }) {
  const { addClips } = useProjectActions();
  const drop = useClipDrop((clipIds) => {
    void addClips(project.project_id, clipIds);
  });
  return (
    <button type="button" className={drop.isOver ? 'project-page__drop project-page__drop--over' : 'project-page__drop'} onClick={onPick} {...drop.handlers}>
      <Icon name="plus" size="md" />
      Drag clips here
    </button>
  );
}

/** "About this project": its facts and the project-wide actions. */
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
      <h2 className="project-about__title">About this project</h2>
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
        Make a short from this project
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
        Search in this project
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
      <button type="button" className="mac-button mac-button--icon" aria-label="Project options" aria-haspopup="menu" onClick={menu.openFromButton}>
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label="Project options"
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
            label: 'Delete project…',
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
        body="The project goes away. Its clips stay in the Gallery."
        confirmLabel="Delete project"
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
  const [prefs, setPrefs] = useGalleryPrefs();
  const selection = useTileSelection();
  const [isAdding, setAdding] = useState(false);
  const clips = state.status === 'ready' ? state.data : [];
  const openAdd = () => {
    setAdding(true);
  };
  const body =
    state.status === 'loading' ? (
      <Skeleton kind="thumb" />
    ) : state.status === 'error' ? (
      <LoadError error={state.error} thing="project" onRetry={refresh} />
    ) : (
      <>
        <GalleryClips
          clips={clips}
          view={prefs.view}
          size={prefs.size}
          selection={selection}
          projectId={project.project_id}
          onDeleted={refresh}
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
    <MacColumns asideLabel="Project" aside={<About project={project} clips={clips} />}>
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
        <span className="mac-columns__sub">Clips stay in the Gallery too. A clip can be in more than one project.</span>
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
 * The project page (`/projects/:id`).
 * @returns The page.
 */
export function MacProjectPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useProjects();
  if (state.status === 'loading') return <Skeleton kind="line" />;
  if (state.status === 'error') return <LoadError error={state.error} thing="projects" onRetry={refresh} />;
  const project = state.data.find((p) => p.project_id === id);
  if (project === undefined) {
    return (
      <EmptyState
        icon="cloud"
        title="This project is gone"
        body="It may have been deleted. Its clips are still in the Gallery."
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
