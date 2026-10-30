// Mac app sidebar (redesign v2, Sidebar board): the logo lockup with the drive folder; Gallery with
// its count; SEGMENTS (colour, name, item count, "+" for a new one; projects are shown as
// segments); FEATURES with Faces and Shorts; ACCESSIBILITY with iGuide, iRead and iListen (New),
// each with its count (owner ruling 2026-10-30); then the On this Mac meter (bytes against the
// cache cap and what happens next), which opens the On this Mac page; and Settings (⌘,). The active
// link is teal text and icon with no fill. Replaces the bottom tab bar in the desktop build.
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { NAV_COPY, SEGMENT_COPY, STUDIO_COPY } from '../../core/copy';
import { displayFolder } from '../../core/desktop-sync';
import { sidebarMeter } from '../../core/on-this-mac';
import { projectItemCount } from '../../core/projects';
import { Icon, type IconName } from '../../design/Icon';
import { isTabActive } from '../../design/TabBar';
import { LogoMark } from '../../design/LogoMark';
import { useSyncStatus } from '../../hooks/useDesktop';
import { useNow } from '../../hooks/useNow';
import { usePeopleOverview, useStorage } from '../../hooks/useOverview';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import { useGuides } from '../../hooks/useGuides';
import { useTextSizeKeys } from '../../hooks/useTextSize';
import { GUIDE_COPY } from '../../core/guides';
import { IREAD_COPY } from '../../core/iread/documents';
import { IREAD_PATH, useDocuments } from '../../hooks/useDocuments';
import { ILISTEN_COPY } from '../../core/ilisten/listens';
import { ILISTEN_PATH, useListens } from '../../hooks/useListens';
import type { Project } from '../../services/api/types';
import { useClipDrop } from './clip-drag';
import { MacSettingsSheet } from './MacSettingsSheet';
import { NewProjectSheet } from './NewProjectSheet';
import { ProjectSwatch } from './ProjectSwatch';
import './MacSidebar.css';

/** One section. `match` lists extra path prefixes that keep it active. */
interface Section {
  to: string;
  label: string;
  icon: IconName;
  match?: readonly string[];
  count?: number | null;
  /** A "New" badge after the label (a feature just added). */
  isNew?: boolean;
}

/** Logo size in the sidebar lockup. */
const LOGO_PX = 22;

/** How often the meter's countdown redraws. */
const METER_TICK_MS = 1000;

/** The On this Mac page's route (it kept the old Sync path, so links and the tray keep working). */
const ON_THIS_MAC = '/sync';

const linkClass = (isActive: boolean) => (isActive ? 'mac-sidebar__link mac-sidebar__link--on' : 'mac-sidebar__link');

function Links({ sections, path }: { sections: readonly Section[]; path: string }) {
  return sections.map((section) => {
    const isActive = isTabActive(section, path);
    return (
      <NavLink key={section.to} to={section.to} className={linkClass(isActive)} aria-current={isActive ? 'page' : undefined}>
        <Icon name={section.icon} size="sm" />
        <span className="mac-sidebar__label">
          {section.label}
          {section.isNew === true && <span className="mac-sidebar__new">{ILISTEN_COPY.isNew}</span>}
        </span>
        {section.count !== undefined && section.count !== null && <span className="mac-sidebar__count">{section.count}</span>}
      </NavLink>
    );
  });
}

/** Gallery, with how many clips there are. */
function Main({ path }: { path: string }) {
  const storage = useStorage();
  const sections: Section[] = [
    { to: '/', label: NAV_COPY.gallery, icon: 'grid', match: ['/clips', '/photos'], count: storage.status === 'ready' ? storage.data.clip_count : null },
  ];
  return <Links sections={sections} path={path} />;
}

/** A titled group of links (FEATURES, ACCESSIBILITY). */
function Group({ id, title, sections, path }: { id: string; title: string; sections: readonly Section[]; path: string }) {
  return (
    <>
      <span className="mac-sidebar__group" id={id}>
        {title}
      </span>
      <div className="mac-sidebar__nav" role="group" aria-labelledby={id}>
        <Links sections={sections} path={path} />
      </div>
    </>
  );
}

/** FEATURES: Faces with how many faces there are, then Shorts. */
function Features({ path }: { path: string }) {
  const { state: people } = usePeopleOverview();
  const sections: Section[] = [
    {
      to: '/people',
      label: NAV_COPY.faces,
      icon: 'face',
      count: people.status === 'ready' ? people.data.people.length + people.data.unnamed.length : null,
    },
    { to: '/shorts', label: STUDIO_COPY.shorts, icon: 'scissors', match: ['/editor'] },
  ];
  return <Group id="mac-sidebar-features" title={NAV_COPY.features} sections={sections} path={path} />;
}

/** ACCESSIBILITY: iGuide with how many there are, iRead with how many letters, then iListen (New) with how many recordings. */
function Accessibility({ path }: { path: string }) {
  const { state: guides } = useGuides();
  const { state: documents } = useDocuments();
  const { state: listens } = useListens();
  const sections: Section[] = [
    { to: '/guides', label: GUIDE_COPY.guides, icon: 'guides', count: guides.status === 'ready' ? guides.data.length : null },
    { to: IREAD_PATH, label: IREAD_COPY.section, icon: 'document', count: documents.status === 'ready' ? documents.data.length : null },
    { to: ILISTEN_PATH, label: ILISTEN_COPY.section, icon: 'wave', isNew: true, count: listens.status === 'ready' ? listens.data.length : null },
  ];
  return <Group id="mac-sidebar-accessibility" title={NAV_COPY.accessibility} sections={sections} path={path} />;
}

/** One segment in the sidebar; Gallery entries of any kind dropped on it join the segment. */
function ProjectLink({ project, path }: { project: Project; path: string }) {
  const { addItems } = useProjectActions();
  const drop = useClipDrop((itemIds) => {
    void addItems(project.project_id, itemIds);
  });
  const to = `/projects/${encodeURIComponent(project.project_id)}`;
  const isActive = path === to;
  return (
    <Link
      to={to}
      className={`${linkClass(isActive)}${drop.isOver ? ' mac-sidebar__link--drop' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      {...drop.handlers}
    >
      <span className="mac-sidebar__swatch">
        <ProjectSwatch color={project.color} />
      </span>
      <span className="mac-sidebar__label">{project.name}</span>
      <span className="mac-sidebar__count">{projectItemCount(project)}</span>
    </Link>
  );
}

/** SEGMENTS: each segment with its colour and item count, and "+" for a new one. */
function Projects({ path }: { path: string }) {
  const { state } = useProjects();
  const [isNewOpen, setNewOpen] = useState(false);
  const projects = state.status === 'ready' ? state.data : [];
  return (
    <>
      <div className="mac-sidebar__group">
        <span id="mac-sidebar-projects">{NAV_COPY.projects}</span>
        <button
          type="button"
          className="mac-sidebar__add"
          aria-label={SEGMENT_COPY.newSegment}
          onClick={() => {
            setNewOpen(true);
          }}
        >
          <Icon name="plus" size="xs" />
        </button>
      </div>
      <div className="mac-sidebar__nav" role="group" aria-labelledby="mac-sidebar-projects">
        {projects.map((project) => (
          <ProjectLink key={project.project_id} project={project} path={path} />
        ))}
      </div>
      <NewProjectSheet
        open={isNewOpen}
        itemIds={[]}
        onClose={() => {
          setNewOpen(false);
        }}
      />
    </>
  );
}

/** "Settings ⌘,": opens the settings; ⌘, opens them from anywhere in the window. */
function SettingsEntry() {
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey && event.key === ',') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <>
      <button
        type="button"
        className="mac-sidebar__link"
        aria-keyshortcuts="Meta+Comma"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="gear" size="sm" />
        <span className="mac-sidebar__label">{NAV_COPY.settings}</span>
        <kbd className="mac-sidebar__kbd">⌘,</kbd>
      </button>
      <MacSettingsSheet
        open={isOpen}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** The On this Mac meter: bytes against the cache cap, a thin bar, and what happens next. */
function Meter({ isActive }: { isActive: boolean }) {
  const { state } = useSyncStatus();
  const now = useNow(METER_TICK_MS);
  if (state.status !== 'ready') return null;
  const meter = sidebarMeter(state.data, now);
  return (
    <Link to={ON_THIS_MAC} className={isActive ? 'mac-sidebar__meter mac-sidebar__meter--on' : 'mac-sidebar__meter'} aria-current={isActive ? 'page' : undefined}>
      <span className="mac-sidebar__meter-head">
        <span className="mac-sidebar__meter-label">On this Mac</span>
        <span className="mac-sidebar__meter-value">{meter.line}</span>
      </span>
      <span className="mac-sidebar__meter-track" aria-hidden="true">
        <span className="mac-sidebar__meter-fill" style={{ width: `${String(meter.percent)}%` }} />
      </span>
      <span className="mac-sidebar__meter-sub" role="status">
        {meter.sub}
      </span>
    </Link>
  );
}

/** The logo, the name and the drive folder. */
function Brand() {
  const { state } = useSyncStatus();
  return (
    <div className="mac-sidebar__brand">
      <LogoMark size={LOGO_PX} />
      <span className="mac-sidebar__lockup">
        <span className="mac-sidebar__name">nimbytes</span>
        {state.status === 'ready' && <span className="mac-sidebar__folder">{displayFolder(state.data.folder)}</span>}
      </span>
    </div>
  );
}

/**
 * The sidebar.
 * @returns The aside element.
 */
export function MacSidebar() {
  const path = useLocation().pathname;
  // The sidebar is always on screen, so ⌘+ / ⌘− / ⌘0 work from every page.
  useTextSizeKeys();
  return (
    <aside className="mac-sidebar">
      <Brand />
      <nav className="mac-sidebar__nav" aria-label="Main">
        <Main path={path} />
        <Projects path={path} />
        <Features path={path} />
        <Accessibility path={path} />
      </nav>
      <div className="mac-sidebar__spacer" />
      <div className="mac-sidebar__foot">
        <Meter isActive={isTabActive({ to: ON_THIS_MAC }, path)} />
        <SettingsEntry />
      </div>
    </aside>
  );
}
