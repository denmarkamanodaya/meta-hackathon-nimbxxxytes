// What a build platform supplies to the composition root. Vite picks the module by build mode
// (`@nimbytes/platform` in vite.config.ts): pwa.ts for the PWA, desktop.tsx for the Mac app.
import type { RouteObject } from 'react-router';
import type { ApiTransport } from '../../core/ports/api-transport';
import type { DesktopBridge } from '../../core/ports/desktop-bridge';
import type { MediaResolver } from '../../core/ports/media-resolver';
import type { DesktopSlots } from '../../hooks/desktop-slots';

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
  /** Desktop-only UI for the shared pages; null in the PWA. */
  slots: DesktopSlots | null;
  /** Routes added under the app shell (the Mac app's `/sync`). */
  routes: RouteObject[];
  /** Pages this build draws its own way (the Mac Library and Upload); absent keeps the PWA page. */
  pages: Partial<Record<'library' | 'upload', RouteObject['lazy']>>;
}
