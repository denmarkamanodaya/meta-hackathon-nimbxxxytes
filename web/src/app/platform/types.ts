// What a build platform supplies to the composition root. Vite picks the module by build mode
// (`@nimbytes/platform` in vite.config.ts): pwa.ts for the PWA, desktop.tsx for the Mac app.
import type { RouteObject } from 'react-router';
import type { ApiTransport } from '../../core/ports/api-transport';
import type { AppearanceControl } from '../../core/ports/appearance';
import type { TextSizeControl } from '../../core/ports/text-size';
import type { DesktopBridge } from '../../core/ports/desktop-bridge';
import type { MediaResolver } from '../../core/ports/media-resolver';
import type { DesktopSlots } from '../../hooks/desktop-slots';
import type { ListenUploadLimit } from '../../core/ilisten/listens';

/** Settings the composition root passes in. */
export interface PlatformOptions {
  /** API base (`/api`); the PWA joins request paths onto it. */
  apiBase: string;
  /** Per-request timeout in ms. */
  timeoutMs: number;
}

/** Adapters, UI slots and extra routes of one build. */
export interface Platform {
  transport: ApiTransport;
  media: MediaResolver;
  /** Native features; null in the PWA. */
  desktop: DesktopBridge | null;
  /** The System / Light / Dark setting; null in the PWA, which is light only. */
  appearance: AppearanceControl | null;
  /** The text size (window zoom); null in the PWA. */
  textSize: TextSizeControl | null;
  /** Desktop-only UI for the shared pages; null in the PWA. */
  slots: DesktopSlots | null;
  /** How large an iListen file this build may send (the Mac's native bridge keeps to less). */
  listenLimit: ListenUploadLimit;
  /** Routes added under the app shell (the Mac app's `/sync`). */
  routes: RouteObject[];
  /**
   * Pages this build draws its own way (the Mac Library, Upload, Search, Faces, clip, Short,
   * Publish, Shorts, Guides and guide pages, iRead and a document, iListen and a recording, a photo); absent keeps the PWA page.
   */
  pages: Partial<
    Record<
      | 'library'
      | 'upload'
      | 'search'
      | 'people'
      | 'clip'
      | 'short'
      | 'publish'
      | 'shorts'
      | 'guides'
      | 'guide'
      | 'iread'
      | 'ireadDocument'
      | 'ilisten'
      | 'ilistenItem'
      | 'photo',
      RouteObject['lazy']
    >
  >;
}
