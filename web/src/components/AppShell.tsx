// App shell: the passcode screen when the session is locked, else the active page above the
// fixed bottom tab bar. In the Mac app: the first-run screen instead of the passcode screen, and a
// left sidebar instead of the tab bar. Holds the screen wake lock while uploads run, on every tab.
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { NAV_COPY, STUDIO_COPY } from '../core/copy';
import { TabBar, type TabItem } from '../design/TabBar';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useSessionCheck, useSessionStatus } from '../hooks/useSession';
import { isUploading, useKeepAwake, useUploads } from '../hooks/useUploads';
import { CreateSheet } from './CreateSheet';
import { OfflineBanner } from './OfflineBanner';
import { PasscodeScreen } from './PasscodeScreen';
import { ToastHost } from './ToastHost';
import './AppShell.css';

const LEFT_TABS: readonly TabItem[] = [
  { to: '/', label: NAV_COPY.gallery, icon: 'library' },
  { to: '/search', label: 'Search', icon: 'search' },
];
const RIGHT_TABS: readonly TabItem[] = [
  { to: '/shorts', label: STUDIO_COPY.name, icon: 'shorts', match: ['/editor', '/productions'] },
  { to: '/people', label: NAV_COPY.faces, icon: 'people' },
];

/** Full-screen pages (a clip, a short, composing a short, a production) have their own bottom bar. */
const isFullScreen = (path: string) =>
  path.startsWith('/clips/') || path.startsWith('/editor') || path.startsWith('/productions/');

/**
 * Layout route: renders the active page and the tab bar, or the passcode screen. Until the
 * session check answers it draws only the page background, so a reload shows no layout first.
 * @returns The shell.
 */
export function AppShell() {
  useSessionCheck();
  const session = useSessionStatus();
  const { items } = useUploads();
  const path = useLocation().pathname;
  useKeepAwake(isUploading(items));
  const hasTabs = !isFullScreen(path);
  const desktop = useDesktopSlots();
  const [isCreateOpen, setCreateOpen] = useState(false);

  if (session === 'unknown') return <div className="app-shell app-shell--checking" aria-busy="true" />;
  if (session === 'locked') return desktop === null ? <PasscodeScreen /> : <desktop.SignIn />;
  if (desktop !== null) {
    return (
      <div className="app-shell app-shell--mac">
        <desktop.Sidebar />
        <main className="app-shell__mac-main">
          <OfflineBanner />
          <Outlet />
        </main>
        <ToastHost />
      </div>
    );
  }
  return (
    <div className={hasTabs ? 'app-shell' : 'app-shell app-shell--full'}>
      <OfflineBanner />
      <main className="app-shell__main">
        <Outlet />
      </main>
      <ToastHost />
      {hasTabs && (
        <TabBar
          left={LEFT_TABS}
          right={RIGHT_TABS}
          centre={{
            label: 'Create',
            isActive: isCreateOpen || path === '/upload',
            onClick: () => {
              setCreateOpen(true);
            },
          }}
        />
      )}
      <CreateSheet
        open={isCreateOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </div>
  );
}
