// App shell: the passcode screen when the session is locked, else the active page above the
// fixed bottom tab bar. Holds the screen wake lock while uploads run, on every tab.
import { Outlet } from 'react-router';
import { TabBar, type TabItem } from '../design/TabBar';
import { useSessionStatus } from '../hooks/useSession';
import { isUploading, useKeepAwake, useUploads } from '../hooks/useUploads';
import { OfflineBanner } from './OfflineBanner';
import { PasscodeScreen } from './PasscodeScreen';
import { ToastHost } from './ToastHost';
import './AppShell.css';

const TABS: readonly TabItem[] = [
  { to: '/', label: 'Library', icon: 'library' },
  { to: '/search', label: 'Search', icon: 'search' },
  { to: '/upload', label: 'Upload', icon: 'upload' },
  { to: '/editor', label: 'Editor', icon: 'editor' },
];

/**
 * Layout route: renders the active page and the tab bar, or the passcode screen.
 * @returns The shell.
 */
export function AppShell() {
  const session = useSessionStatus();
  const { items } = useUploads();
  useKeepAwake(isUploading(items));

  if (session === 'locked') return <PasscodeScreen />;
  return (
    <div className="app-shell">
      <OfflineBanner />
      <main className="app-shell__main">
        <Outlet />
      </main>
      <ToastHost />
      <TabBar items={TABS} />
    </div>
  );
}
