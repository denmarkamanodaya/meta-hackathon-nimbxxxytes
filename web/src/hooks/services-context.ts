// React context that carries the composed services from src/app/ to hooks. Hooks never build
// adapters themselves, so tests swap any service by providing a different value.
import { createContext, useContext } from 'react';
import type { ApiClient } from '../services/api/client';
import type { ClipEventSource } from '../services/events/clip-events';
import type { ShortStepSource } from '../services/events/short-steps';
import type { RecentQueryStore } from '../services/search/recent-store';
import type { SearchCache } from '../services/search/search-cache';
import type { ShareVideo } from '../services/share/share-video';
import type { DeviceInfo } from '../core/install-hint';
import type { InstallHintStore } from '../services/device';
import type { ToastStore } from '../services/toast/toast-store';
import type { SessionStore } from '../services/session/session-store';
import type { UploadQueue } from '../services/upload/queue';
import type { WakeLockKeeper } from '../services/wake-lock';

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
  /** Recent search queries (localStorage). */
  recents: RecentQueryStore;
  /** Recent search answers, for instant back navigation. */
  searchCache: SearchCache;
  /** Shares a rendered MP4 through the system share sheet. */
  shareVideo: ShareVideo;
  /** App-wide toasts. */
  toasts: ToastStore;
  /** Device facts read once at start (install hint). */
  device: DeviceInfo;
  /** Remembers a dismissed install hint. */
  installHint: InstallHintStore;
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
