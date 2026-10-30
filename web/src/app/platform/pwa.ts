// PWA platform: same-origin fetch and EventSource, cloud media URLs, no native features, and the
// Night / Light / Match-system theme the Mac app uses (Night first). A window at least
// `WIDE_QUERY` wide when the app opens gets the Mac layout: the sidebar and the Mac pages, with
// the Mac-only controls (this Mac's drive, Finder, Final Cut) hidden; a phone keeps the tab bar.
import { MacSidebar } from '../../components/desktop/MacSidebar';
import { ShortInspector } from '../../components/desktop/ShortInspector';
import { PasscodeScreen } from '../../components/PasscodeScreen';
import { createFetchTransport } from '../../services/api/fetch-transport';
import { createAppearanceStore, createDocumentAppearance } from '../../services/appearance/appearance';
import { safeLocalStorage } from '../../services/browser-storage';
import { cloudMediaResolver } from '../../services/media/cloud-media';
import { PWA_LISTEN_LIMIT } from '../../core/ilisten/listens';
import { BROWSER_MAC_PAGES, MAC_PROJECT_ROUTE } from './mac-pages';
import type { Platform, PlatformOptions } from './types';

/** The width from which a browser window gets the Mac layout (read once, when the app opens). */
const WIDE_QUERY = '(min-width: 1100px)';

/** The browser has no "Make available offline": a clip page shows nothing there. */
const NoClipOffline = () => null;

/**
 * Builds the PWA platform.
 * @param options - API base and timeout.
 * @returns The platform.
 */
export function createPlatform(options: PlatformOptions): Platform {
  const isWide = typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
  return {
    transport: createFetchTransport({ baseUrl: options.apiBase, timeoutMs: options.timeoutMs }),
    media: cloudMediaResolver,
    desktop: null,
    appearance: createDocumentAppearance({
      store: createAppearanceStore(safeLocalStorage()),
      darkMode: typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null,
      root: document.documentElement,
      events: window,
      themeMeta: document.querySelector<HTMLMetaElement>('meta[name="theme-color"]'),
    }),
    textSize: null,
    slots: isWide ? { Sidebar: MacSidebar, SignIn: PasscodeScreen, ClipOffline: NoClipOffline, ShortInspector } : null,
    listenLimit: PWA_LISTEN_LIMIT,
    routes: isWide ? [MAC_PROJECT_ROUTE] : [],
    pages: isWide ? BROWSER_MAC_PAGES : {},
  };
}
