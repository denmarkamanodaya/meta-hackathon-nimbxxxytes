// Mac app sidebar (mocks M1–M4): the logo lockup; Library and People & pets (no Search: the
// Library is the search; Upload is the Library's toolbar button); the Studio group with Shorts;
// then the "On this Mac" meter (the bytes on this Mac, what they are, and the sync line), which
// opens the On this Mac page; and Settings (⌘,). Replaces the bottom tab bar in the desktop build.
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { STUDIO_COPY } from '../../core/copy';
import { meterStatus, onThisMacView } from '../../core/on-this-mac';
import { formatGb } from '../../core/storage';
import { Icon, type IconName } from '../../design/Icon';
import { isTabActive } from '../../design/TabBar';
import { LogoMark } from '../../design/LogoMark';
import { useSyncStatus } from '../../hooks/useDesktop';
import { useNow } from '../../hooks/useNow';
import { useStorage } from '../../hooks/useOverview';
import { MacSettingsSheet } from './MacSettingsSheet';
import './MacSidebar.css';

/** One section. `match` lists extra path prefixes that keep it active. */
interface Section {
  to: string;
  label: string;
  icon: IconName;
  match?: readonly string[];
}

/** Logo size in the sidebar lockup (M1). */
const LOGO_PX = 30;

/** How often the meter's countdown and "2 min ago" redraw. */
const METER_TICK_MS = 1000;

/** The On this Mac page's route (it kept the old Sync path, so links and the tray keep working). */
const ON_THIS_MAC = '/sync';

const SECTIONS: readonly Section[] = [
  { to: '/', label: 'Library', icon: 'library', match: ['/clips'] },
  { to: '/people', label: 'People & pets', icon: 'people' },
];

/** The Studio group: Shorts now; Productions joins it once it works. */
const STUDIO: readonly Section[] = [{ to: '/shorts', label: STUDIO_COPY.shorts, icon: 'shorts', match: ['/editor'] }];

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
        <Icon name={section.icon} size="md" />
        {section.label}
      </NavLink>
    );
  });
}

/** "Settings ⌘,": opens the settings sheet; ⌘, opens it from anywhere in the window. */
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
        className="mac-sidebar__link mac-sidebar__settings"
        aria-keyshortcuts="Meta+Comma"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Icon name="account" size="md" />
        Settings
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

/** The "On this Mac" meter: the bytes on this Mac, what they are, and the sync line. */
function Meter({ isActive }: { isActive: boolean }) {
  const { state } = useSyncStatus();
  const storage = useStorage();
  const now = useNow(METER_TICK_MS);
  if (state.status !== 'ready') return null;
  const view = onThisMacView(state.data, now);
  const sync = meterStatus(state.data, now);
  const isStored = view.kept.length > 0 || view.isPlaying;
  const library = storage.status === 'ready' ? `of ${formatGb(storage.data.cloud_bytes)} in your library` : null;
  return (
    <Link
      to={ON_THIS_MAC}
      className={isActive ? 'mac-sidebar__meter mac-sidebar__meter--on' : 'mac-sidebar__meter'}
      aria-current={isActive ? 'page' : undefined}
    >
      <span className="mac-sidebar__meter-label">On this Mac</span>
      <span className="mac-sidebar__meter-number">{view.spaceUsed}</span>
      {isStored
        ? view.stateLines.map((line) => (
            <span key={line} className="mac-sidebar__meter-line">
              {line}
            </span>
          ))
        : library !== null && <span className="mac-sidebar__meter-line">{library}</span>}
      <span className="mac-sidebar__meter-line mac-sidebar__meter-sync" role="status">
        <span
          className={`mac-sidebar__dot mac-sidebar__dot--${sync.tone}${sync.isBusy ? ' mac-sidebar__dot--pulse' : ''}`}
          aria-hidden="true"
        />
        {sync.line}
      </span>
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
      <Meter isActive={isTabActive({ to: ON_THIS_MAC }, path)} />
      <SettingsEntry />
    </aside>
  );
}
