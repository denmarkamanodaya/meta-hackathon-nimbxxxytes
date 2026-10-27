// Mac app platform: API and SSE over Tauri invoke, media from ~/nimbytes when synced, the native
// bridge, the desktop UI slots (sidebar, first run, Short page cards), the Mac Library and Upload
// pages (Search redirects to the Library) and the /sync route (approved mocks M1–M4). Only the `desktop` build mode includes it.
import { ClipOfflineSwitch } from '../../components/desktop/ClipOfflineSwitch';
import { MacFirstRun } from '../../components/desktop/MacFirstRun';
import { MacSidebar } from '../../components/desktop/MacSidebar';
import { ShortFinish } from '../../components/desktop/ShortFinish';
import { ShortScore } from '../../components/desktop/ShortScore';
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
    slots: {
      Sidebar: MacSidebar,
      SignIn: MacFirstRun,
      ClipOffline: ClipOfflineSwitch,
      ShortFinish,
      ShortScore,
    },
    routes: [
      {
        path: 'sync',
        lazy: async () => ({ Component: (await import('../../pages/SyncPage')).SyncPage }),
      },
    ],
    pages: {
      library: async () => ({ Component: (await import('../../pages/desktop/MacLibraryPage')).MacLibraryPage }),
      upload: async () => ({ Component: (await import('../../pages/desktop/MacUploadPage')).MacUploadPage }),
      search: async () => ({ Component: (await import('../../pages/desktop/MacSearchRedirect')).MacSearchRedirect }),
    },
  };
}
