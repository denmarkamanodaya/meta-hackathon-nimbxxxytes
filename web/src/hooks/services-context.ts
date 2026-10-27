// React context that carries the composed services from src/app/ to hooks. Hooks never build
// adapters themselves, so tests swap any service by providing a different value.
import { createContext, useContext } from 'react';
import type { ApiClient } from '../services/api/client';
import type { ClipEventSource } from '../services/events/clip-events';
import type { ShortStepSource } from '../services/events/short-steps';
import type { StudioStepSource } from '../services/events/studio-steps';
import type { StudioViewStore } from '../services/studio-view';
import type { GalleryPrefsStore } from '../services/gallery-prefs';
import type { PutPart } from '../services/upload/put-part';
import type { RecentQueryStore } from '../services/search/recent-store';
import type { SearchCache } from '../services/search/search-cache';
import type { ShareVideo } from '../services/share/share-video';
import type { CopyText } from '../services/share/copy-text';
import type { DeviceInfo } from '../core/install-hint';
import type { InstallHintStore } from '../services/device';
import type { ToastStore } from '../services/toast/toast-store';
import type { SessionStore } from '../services/session/session-store';
import type { UploadQueue } from '../services/upload/queue';
import type { WakeLockKeeper } from '../services/wake-lock';
import type { DismissedMatches } from '../services/people/dismissed-matches';
import type { AppearanceControl } from '../core/ports/appearance';
import type { DesktopBridge } from '../core/ports/desktop-bridge';
import type { MediaResolver } from '../core/ports/media-resolver';

/** Every service a hook may use, bound once by the composition root. */
export interface Services {
  api: ApiClient;
  session: SessionStore;
  uploads: UploadQueue;
  wakeLock: WakeLockKeeper;
  /** Subscribes to a clip's live ingest steps (SSE). */
  events: ClipEventSource;
  /** Subscribes to a short's live agent steps (SSE). */
  shortSteps: ShortStepSource;
  /** Subscribes to a production's live plan and coverage steps (SSE). */
  productionSteps: StudioStepSource;
  /** Subscribes to a short's live publish steps (SSE). */
  exportSteps: StudioStepSource;
  /** Sends a file to a presigned PUT URL (brand kit images). */
  putFile: PutPart;
  /** The Studio's Shorts or Productions list, remembered for the session. */
  studioView: StudioViewStore;
  /** The Gallery's grid/list choice and thumbnail size (localStorage). */
  galleryPrefs: GalleryPrefsStore;
  /** Recent search queries (localStorage). */
  recents: RecentQueryStore;
  /** Recent search answers, for instant back navigation. */
  searchCache: SearchCache;
  /** Shares a rendered MP4 through the system share sheet. */
  shareVideo: ShareVideo;
  /** Puts text on the clipboard. */
  copyText: CopyText;
  /** App-wide toasts. */
  toasts: ToastStore;
  /** Device facts read once at start (install hint). */
  device: DeviceInfo;
  /** Remembers a dismissed install hint. */
  installHint: InstallHintStore;
  /** Face-match suggestions answered "Not them" this session. */
  dismissedMatches: DismissedMatches;
  /** Picks the playable URL of a clip or render (local copy in the Mac app). */
  media: MediaResolver;
  /** The Mac app's native features; null in the PWA. */
  desktop: DesktopBridge | null;
  /** The Mac app's System / Light / Dark setting; null in the PWA (light only). */
  appearance: AppearanceControl | null;
  /** Mac app download page for the PWA Settings row; null hides the row. */
  macDownloadUrl: string | null;
}

/** Holds the bound services; `src/app/providers.tsx` supplies the value. */
export const ServicesContext = createContext<Services | null>(null);

/**
 * Returns the services from context.
 * @returns The services the composition root bound.
 * @throws Error when no `ServicesContext` provider wraps the caller (a wiring bug).
 */
export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error('useServices called outside ServicesContext provider');
  return services;
}
