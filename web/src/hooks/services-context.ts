// React context that carries the composed services from src/app/ to hooks. Hooks never build
// adapters themselves, so tests swap any service by providing a different value.
import { createContext, useContext } from 'react';
import type { ApiClient } from '../services/api/client';
import type { ClipEventSource } from '../services/events/clip-events';
import type { ShortStepSource } from '../services/events/short-steps';
import type { StudioStepSource } from '../services/events/studio-steps';
import type { GalleryPrefsStore } from '../services/gallery-prefs';
import type { ListenPrefsStore } from '../services/listen-prefs';
import type { PhotoQueue } from '../services/upload/photo-queue';
import type { ListenUploadLimit } from '../core/ilisten/listens';
import type { PutPart } from '../services/upload/put-part';
import type { RecentQueryStore } from '../services/search/recent-store';
import type { SearchCache } from '../services/search/search-cache';
import type { ShareVideo } from '../services/share/share-video';
import type { StepAudio } from '../services/media/step-audio';
import type { VoiceRecorder } from '../services/media/voice-recorder';
import type { CopyText } from '../services/share/copy-text';
import type { CopyImage } from '../services/share/copy-image';
import type { DeviceInfo } from '../core/install-hint';
import type { InstallHintStore } from '../services/device';
import type { ToastStore } from '../services/toast/toast-store';
import type { SessionStore } from '../services/session/session-store';
import type { UploadQueue } from '../services/upload/queue';
import type { WakeLockKeeper } from '../services/wake-lock';
import type { DismissedMatches } from '../services/people/dismissed-matches';
import type { AppearanceControl } from '../core/ports/appearance';
import type { TextSizeControl } from '../core/ports/text-size';
import type { DesktopBridge } from '../core/ports/desktop-bridge';
import type { MediaResolver } from '../core/ports/media-resolver';
import type { Speaker } from '../core/ports/speaker';

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
  /** Subscribes to a short's live publish steps (SSE). */
  exportSteps: StudioStepSource;
  /** Sends a file to a presigned PUT URL (brand kit images). */
  putFile: PutPart;
  /** The Gallery's grid/list choice and thumbnail size (localStorage). */
  galleryPrefs: GalleryPrefsStore;
  /** iListen's output language (localStorage). */
  listenPrefs: ListenPrefsStore;
  /** Photos going up, three at a time (the Gallery's "Uploading 12 photos" card). */
  photoUploads: PhotoQueue;
  /** How large an iListen file this build may send (from the platform). */
  listenLimit: ListenUploadLimit;
  /** Recent search queries (localStorage). */
  recents: RecentQueryStore;
  /** Recent search answers, for instant back navigation. */
  searchCache: SearchCache;
  /** Shares a rendered MP4 through the system share sheet. */
  shareVideo: ShareVideo;
  /** Puts text on the clipboard. */
  copyText: CopyText;
  /** Plays a server WAV: the read-aloud fallback when the device voice cannot speak. */
  stepAudio: StepAudio;
  /** The device's own voice, which reads every text aloud (`useReadAloudText`). */
  speaker: Speaker;
  /** Records the Ask box's hold-to-talk voice notes. */
  voice: VoiceRecorder;
  /** Puts an image on the clipboard (its link where images cannot go there). */
  copyImage: CopyImage;
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
  /** The Mac app's text size (window zoom); null in the PWA (the phone's own text size applies). */
  textSize: TextSizeControl | null;
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
