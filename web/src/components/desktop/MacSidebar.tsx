// Mac app sidebar (mocks M1–M4): the logo lockup, the sections (no Search: the Library is the
// search), the Studio group with Shorts, and at the bottom the sync status block ("Synced · 2 min
// ago · ~/nimbytes") that opens the Sync page. Replaces the bottom tab bar in the desktop build.
import { Link, NavLink, useLocation } from 'react-router';
import { STUDIO_COPY } from '../../core/copy';
import { sidebarStatus } from '../../core/desktop-sync';
import { isTabActive } from '../../design/TabBar';
import { LogoMark } from '../../design/LogoMark';
import { useSyncStatus } from '../../hooks/useDesktop';
import './MacSidebar.css';

/** One section. `match` lists extra path prefixes that keep it active. */
interface Section {
  to: string;
  label: string;
  match?: readonly string[];
}

/** Logo size in the sidebar lockup (M1). */
const LOGO_PX = 30;

const SECTIONS: readonly Section[] = [
  { to: '/', label: 'Library', match: ['/clips'] },
  { to: '/people', label: 'People & pets' },
  { to: '/upload', label: 'Upload' },
  { to: '/sync', label: 'Sync' },
];

/** The Studio group: Shorts now; Productions joins it once it works. */
const STUDIO: readonly Section[] = [{ to: '/shorts', label: STUDIO_COPY.shorts, match: ['/editor'] }];

function Links({ sections, path }: { sections: readonly Section[]; path: string }) {
  return sections.map((section) => {
    const isActive = isTabActive(section, path);
    return (
      <NavLink
        key={section.to}
        to={section.to}
        className={isActive ? 'mac-sidebar__link mac-sidebar__link--on' : 'mac-sidebar__link'}
        aria-current={isActive ? 'page' : undefined}
      >
        {section.label}
      </NavLink>
    );
  });
}

function StatusBlock() {
  const { state } = useSyncStatus();
  if (state.status !== 'ready') return null;
  const block = sidebarStatus(state.data, new Date());
  return (
    <Link to="/sync" className="mac-sidebar__status">
      <span className="mac-sidebar__status-label">
        <span className={`mac-sidebar__dot mac-sidebar__dot--${block.tone}`} aria-hidden="true" />
        {block.label}
      </span>
      <span className="mac-sidebar__status-line">{block.line}</span>
    </Link>
  );
}

/**
 * The sidebar.
 * @returns The aside element.
 */
export function MacSidebar() {
  const path = useLocation().pathname;
  return (
    <aside className="mac-sidebar">
      <div className="mac-sidebar__brand">
        <LogoMark size={LOGO_PX} />
        <span className="mac-sidebar__name">nimbytes</span>
      </div>
      <nav className="mac-sidebar__nav" aria-label="Main">
        <Links sections={SECTIONS} path={path} />
        <span className="mac-sidebar__group" id="mac-sidebar-studio">
          {STUDIO_COPY.name}
        </span>
        <div className="mac-sidebar__nav" role="group" aria-labelledby="mac-sidebar-studio">
          <Links sections={STUDIO} path={path} />
        </div>
      </nav>
      <div className="mac-sidebar__spacer" />
      <StatusBlock />
    </aside>
  );
}
