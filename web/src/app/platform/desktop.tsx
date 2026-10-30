// Mac app platform: API and SSE over Tauri invoke, media from ~/nimbytes when synced, the native
// bridge, the desktop UI slots (sidebar, first run, Short page cards), the Mac Library (Search and
// Upload redirect to it; Upload is the Gallery's native dialog), the Faces page, the clip page with its player, the
// Shorts pages (Shorts, a short and its Publish page), the MyWay
// Guides list and guide pages, the iRead list and document pages, the /sync route
// (approved mocks M1–M4) and the appearance and text-size settings, applied here before the first render so the
// window never flashes the other theme. Only the `desktop` build mode includes it.
import { MAC_LISTEN_LIMIT } from '../../core/ilisten/listens';
import { ClipOfflineSwitch } from '../../components/desktop/ClipOfflineSwitch';
import { MacFirstRun } from '../../components/desktop/MacFirstRun';
import { MacSidebar } from '../../components/desktop/MacSidebar';
import { ShortInspector } from '../../components/desktop/ShortInspector';
import { createAppearanceStore, createDocumentAppearance } from '../../services/appearance/appearance';
import { safeLocalStorage } from '../../services/browser-storage';
import { createInvokeTransport } from '../../services/desktop/invoke-transport';
import { createLocalMediaResolver } from '../../services/desktop/local-media';
import { createNativeBridge } from '../../services/desktop/native-bridge';
import { tauriIpc, tauriZoom } from '../../services/desktop/tauri-bridge';
import { createWindowTextSize } from '../../services/text-size/text-size';
import { MAC_PAGES, MAC_PROJECT_ROUTE } from './mac-pages';
import type { Platform, PlatformOptions } from './types';

/**
 * Builds the Mac app platform.
 * @param options - Timeout (the API base is the native side's server URL, not used here).
 * @returns The platform.
 */
export function createPlatform(options: PlatformOptions): Platform {
  return {
    transport: createInvokeTransport(tauriIpc, options.timeoutMs),
    media: createLocalMediaResolver(tauriIpc),
    desktop: createNativeBridge(tauriIpc),
    appearance: createDocumentAppearance({
      store: createAppearanceStore(safeLocalStorage()),
      darkMode: window.matchMedia('(prefers-color-scheme: dark)'),
      root: document.documentElement,
      events: window,
    }),
    textSize: createWindowTextSize({ storage: safeLocalStorage(), zoom: tauriZoom }),
    slots: {
      Sidebar: MacSidebar,
      SignIn: MacFirstRun,
      ClipOffline: ClipOfflineSwitch,
      ShortInspector,
    },
    listenLimit: MAC_LISTEN_LIMIT,
    routes: [
      {
        path: 'sync',
        lazy: async () => ({ Component: (await import('../../pages/OnThisMacPage')).OnThisMacPage }),
      },
      MAC_PROJECT_ROUTE,
    ],
    pages: MAC_PAGES,
  };
}
