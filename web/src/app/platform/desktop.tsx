// Mac app platform: API and SSE over Tauri invoke, media from ~/nimbytes when synced, the native
// bridge, the desktop UI slots (sidebar, first run, Short page cards), the Mac Library (Search and
// Upload redirect to it; Upload is the Gallery's native dialog), the Faces page, the clip page with its player, the
// /sync route (approved mocks M1–M4) and the appearance setting, applied here before the first
// render so the window never flashes the other theme. Only the `desktop` build mode includes it.
import { ClipOfflineSwitch } from '../../components/desktop/ClipOfflineSwitch';
import { MacFirstRun } from '../../components/desktop/MacFirstRun';
import { MacSidebar } from '../../components/desktop/MacSidebar';
import { ShortInspector } from '../../components/desktop/ShortInspector';
import { createAppearanceStore, createDocumentAppearance } from '../../services/appearance/appearance';
import { safeLocalStorage } from '../../services/browser-storage';
import { createInvokeTransport } from '../../services/desktop/invoke-transport';
import { createLocalMediaResolver } from '../../services/desktop/local-media';
import { createNativeBridge } from '../../services/desktop/native-bridge';
import { tauriIpc } from '../../services/desktop/tauri-bridge';
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
    slots: {
      Sidebar: MacSidebar,
      SignIn: MacFirstRun,
      ClipOffline: ClipOfflineSwitch,
      ShortInspector,
    },
    routes: [
      {
        path: 'sync',
        lazy: async () => ({ Component: (await import('../../pages/OnThisMacPage')).OnThisMacPage }),
      },
      {
        path: 'projects/:id',
        lazy: async () => ({ Component: (await import('../../pages/desktop/MacProjectPage')).MacProjectPage }),
      },
    ],
    pages: {
      library: async () => ({ Component: (await import('../../pages/desktop/MacLibraryPage')).MacLibraryPage }),
      upload: async () => ({ Component: (await import('../../pages/desktop/MacUploadRedirect')).MacUploadRedirect }),
      search: async () => ({ Component: (await import('../../pages/desktop/MacSearchRedirect')).MacSearchRedirect }),
      people: async () => ({ Component: (await import('../../pages/desktop/MacFacesPage')).MacFacesPage }),
      clip: async () => ({ Component: (await import('../../pages/desktop/MacClipPage')).MacClipPage }),
      short: async () => ({ Component: (await import('../../pages/desktop/MacShortPage')).MacShortPage }),
      production: async () => ({ Component: (await import('../../pages/desktop/MacProductionPage')).MacProductionPage }),
      productions: async () => ({ Component: (await import('../../pages/desktop/MacProductionsPage')).MacProductionsPage }),
    },
  };
}
