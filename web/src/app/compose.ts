// Composition root: builds every adapter once from the parsed env and binds it for hooks.
import type { Services } from '../hooks/services-context';
import { createApiClient } from '../services/api/client';
import { safeLocalStorage } from '../services/browser-storage';
import { clipEventSourceOver } from '../services/events/clip-events';
import type { OpenStream } from '../services/events/sse';
import { shortStepSourceOver } from '../services/events/short-steps';
import { exportStepSourceOver } from '../services/events/studio-steps';
import { createGalleryPrefsStore } from '../services/gallery-prefs';
import { createRecentQueryStore } from '../services/search/recent-store';
import { createSearchCache } from '../services/search/search-cache';
import { createVideoSharer } from '../services/share/share-video';
import { createTextCopier } from '../services/share/copy-text';
import { createDeviceVoice } from '../services/media/device-voice';
import { createStepAudio } from '../services/media/step-audio';
import { createVoiceRecorder, mediaRecorderTarget, pickVoiceType } from '../services/media/voice-recorder';
import { createImageCopier } from '../services/share/copy-image';
import { createInstallHintStore, readDevice } from '../services/device';
import { createToastStore } from '../services/toast/toast-store';
import { createSessionStore } from '../services/session/session-store';
import { createXhrPutPart } from '../services/upload/put-part';
import { createUploadQueue } from '../services/upload/queue';
import { createBrowserResumeStore } from '../services/upload/resume-store';
import { uploadFile, type UploadFileDeps } from '../services/upload/upload-file';
import { createWakeLockKeeper } from '../services/wake-lock';
import { createDismissedMatches } from '../services/people/dismissed-matches';
import { createPlatform } from '@nimbytes/platform';
import { env } from './env';

/** API call timeout in ms. */
const API_TIMEOUT_MS = 15_000;
/** Per-part timeout in ms: a 16 MiB part at ~0.5 Mbit/s mobile upload still fits. */
const PART_TIMEOUT_MS = 300_000;

/** This build's adapters, UI slots and extra routes (PWA or Mac app, chosen by the build mode). */
export const platform = createPlatform({ apiBase: env.apiBase, timeoutMs: API_TIMEOUT_MS });

const session = createSessionStore();

const api = createApiClient({
  baseUrl: env.apiBase,
  timeoutMs: API_TIMEOUT_MS,
  transport: platform.transport,
  onUnauthorized: () => {
    session.lock();
  },
});

const putPart = createXhrPutPart(PART_TIMEOUT_MS);

const uploadDeps: UploadFileDeps = {
  api,
  store: createBrowserResumeStore(),
  putPart,
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, ms);
    }),
  concurrency: 3,
  maxAttempts: 3,
  retryBaseMs: 1000,
};

const uploads = createUploadQueue({
  run: (file, onProgress) => uploadFile(file, uploadDeps, onProgress),
  now: () => performance.now(),
  rateWindowMs: 3000,
});

const wakeLock = createWakeLockKeeper(
  'wakeLock' in navigator ? navigator.wakeLock : undefined,
  document,
);

const openStream: OpenStream = (path, onData) => platform.transport.openStream(path, onData);

const events = clipEventSourceOver(openStream);

const copyText = createTextCopier('clipboard' in navigator ? navigator.clipboard : undefined);

const media = 'mediaDevices' in navigator ? navigator.mediaDevices : undefined;
const hasRecorder = typeof MediaRecorder !== 'undefined';
const voiceType = hasRecorder ? pickVoiceType((type) => MediaRecorder.isTypeSupported(type)) : undefined;

const voice = createVoiceRecorder({
  getUserMedia: media === undefined ? undefined : (constraints) => media.getUserMedia(constraints),
  makeRecorder: hasRecorder
    ? (stream: MediaStream) => mediaRecorderTarget(new MediaRecorder(stream, voiceType === undefined ? {} : { mimeType: voiceType }))
    : undefined,
});

const speaker = createDeviceVoice({
  synth: 'speechSynthesis' in window ? window.speechSynthesis : undefined,
  makeUtterance: (text) => new SpeechSynthesisUtterance(text),
  // Dev only: which voice the device gave, once each time it changes.
  onVoice: env.isProd
    ? undefined
    : (name) => {
        console.debug(`read-aloud voice: ${name}`);
      },
});

/** The app's services, bound once per page load. */
export const services: Services = {
  api,
  session,
  uploads,
  wakeLock,
  events,
  shortSteps: shortStepSourceOver(openStream),
  exportSteps: exportStepSourceOver(openStream),
  putFile: putPart,
  galleryPrefs: createGalleryPrefsStore(safeLocalStorage()),
  recents: createRecentQueryStore(safeLocalStorage()),
  searchCache: createSearchCache(10),
  shareVideo: createVideoSharer(navigator),
  copyText,
  stepAudio: createStepAudio(() => new Audio()),
  speaker,
  voice,
  copyImage: createImageCopier({
    clipboard: 'clipboard' in navigator ? navigator.clipboard : undefined,
    makeItem: 'ClipboardItem' in globalThis ? (items) => new ClipboardItem(items) : undefined,
    copyText,
  }),
  toasts: createToastStore((run, ms) => {
    setTimeout(run, ms);
  }),
  device: readDevice(),
  installHint: createInstallHintStore(safeLocalStorage()),
  dismissedMatches: createDismissedMatches(),
  media: platform.media,
  desktop: platform.desktop,
  appearance: platform.appearance,
  textSize: platform.textSize,
  // The Mac app is already installed; only the PWA offers the download.
  macDownloadUrl: env.isDesktop ? null : env.macDownloadUrl,
};
