// Composition root: builds every adapter once from the parsed env and binds it for hooks.
import type { Services } from '../hooks/services-context';
import { createApiClient } from '../services/api/client';
import { createSessionStore } from '../services/session/session-store';
import { createXhrPutPart } from '../services/upload/put-part';
import { createUploadQueue } from '../services/upload/queue';
import { createBrowserResumeStore } from '../services/upload/resume-store';
import { uploadFile, type UploadFileDeps } from '../services/upload/upload-file';
import { createWakeLockKeeper } from '../services/wake-lock';
import { env } from './env';

/** API call timeout in ms. */
const API_TIMEOUT_MS = 15_000;
/** Per-part timeout in ms: a 16 MiB part at ~0.5 Mbit/s mobile upload still fits. */
const PART_TIMEOUT_MS = 300_000;

const session = createSessionStore();

const api = createApiClient({
  baseUrl: env.apiBase,
  timeoutMs: API_TIMEOUT_MS,
  onUnauthorized: () => {
    session.lock();
  },
});

const uploadDeps: UploadFileDeps = {
  api,
  store: createBrowserResumeStore(),
  putPart: createXhrPutPart(PART_TIMEOUT_MS),
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

/** The app's services, bound once per page load. */
export const services: Services = { api, session, uploads, wakeLock };
