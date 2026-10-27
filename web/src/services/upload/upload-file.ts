// Uploads one file as an S3 multipart upload: create (or resume), send missing parts with a
// small worker pool, save progress after every part, then complete. Resume state is keyed by
// the file fingerprint, so picking the same file again continues from the last finished part.
import { ApiError, type ApiClient } from '../api/client';
import { ERROR, type CompletedPart, type PresignedPart } from '../api/types';
import { bytesDone, fingerprint, missingParts, planParts, type PartRange } from './plan';
import type { PutPart } from './put-part';
import type { ResumeState, ResumeStore } from './resume-store';

/** Ports and limits `uploadFile` needs; the composition root binds the real ones. */
export interface UploadFileDeps {
  api: Pick<ApiClient, 'createUpload' | 'presignParts' | 'completeUpload'>;
  store: ResumeStore;
  putPart: PutPart;
  /** Waits `ms` milliseconds; injected so tests do not sleep. */
  sleep: (ms: number) => Promise<void>;
  /** Parts in flight at once for this file. */
  concurrency: number;
  /** Tries per part before the file fails (first try included). */
  maxAttempts: number;
  /** Delay before the first retry; doubles each retry. */
  retryBaseMs: number;
}

/**
 * Progress of one file: bytes in S3 or in flight, finished parts out of all parts, and whether
 * it resumed earlier work.
 */
export interface UploadProgress {
  loadedBytes: number;
  resumed: boolean;
  partsDone: number;
  partsTotal: number;
}

interface Session {
  key: string;
  state: ResumeState;
  plan: PartRange[];
  urls: Map<number, string>;
  resumed: boolean;
}

const toUrlMap = (parts: readonly PresignedPart[]) => new Map(parts.map((p) => [p.n, p.url]));

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

async function resumeSession(file: File, deps: UploadFileDeps): Promise<Session | null> {
  const key = fingerprint(file);
  const saved = await deps.store.load(key);
  if (saved === null) return null;
  const plan = planParts(file.size, saved.partSizeBytes);
  const missing = missingParts(plan, saved.doneParts);
  if (missing.length === 0) return { key, state: saved, plan, urls: new Map(), resumed: true };
  try {
    const { parts } = await deps.api.presignParts(saved.uploadId, missing);
    return { key, state: saved, plan, urls: toUrlMap(parts), resumed: true };
  } catch (error) {
    const gone =
      error instanceof ApiError && (error.code === ERROR.NOT_FOUND || error.code === ERROR.FORBIDDEN);
    if (!gone) throw error;
    await deps.store.remove(key); // Recovers: the server forgot this upload; start over.
    return null;
  }
}

async function startSession(file: File, deps: UploadFileDeps): Promise<Session> {
  const created = await deps.api.createUpload({
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type === '' ? 'application/octet-stream' : file.type,
  });
  const state: ResumeState = {
    uploadId: created.upload_id,
    clipId: created.clip_id,
    partSizeBytes: created.part_size,
    doneParts: [],
  };
  const key = fingerprint(file);
  await deps.store.save(key, state);
  const plan = planParts(file.size, created.part_size);
  return { key, state, plan, urls: toUrlMap(created.parts), resumed: false };
}

async function sendPart(
  part: PartRange,
  session: Session,
  ctx: { file: File; deps: UploadFileDeps; signal: AbortSignal; onBytes: (n: number) => void },
): Promise<string> {
  const { deps, signal } = ctx;
  for (let attempt = 1; ; attempt += 1) {
    const url = session.urls.get(part.n);
    if (url === undefined) throw new ApiError('BAD_RESPONSE', `No URL for part ${String(part.n)}`, null);
    try {
      return await deps.putPart(url, ctx.file.slice(part.start, part.end), ctx.onBytes, signal);
    } catch (error) {
      if (isAbort(error) || attempt >= deps.maxAttempts) throw error;
      ctx.onBytes(0);
      await deps.sleep(deps.retryBaseMs * 2 ** (attempt - 1));
      if (error instanceof ApiError && error.status === 403) {
        // Presigned URLs expire after 15 minutes; fetch a fresh one for this part.
        const { parts } = await deps.api.presignParts(session.state.uploadId, [part.n]);
        for (const p of parts) session.urls.set(p.n, p.url);
      }
    }
  }
}

async function sendMissingParts(
  file: File,
  session: Session,
  deps: UploadFileDeps,
  report: (inFlight: Map<number, number>) => void,
  signal: AbortSignal,
): Promise<void> {
  const missing = new Set(missingParts(session.plan, session.state.doneParts));
  const queue = session.plan.filter((part) => missing.has(part.n));
  const inFlight = new Map<number, number>();
  const pool = new AbortController();
  const stop = () => {
    pool.abort();
  };
  signal.addEventListener('abort', stop);

  async function worker(): Promise<void> {
    for (let part = queue.shift(); part !== undefined; part = queue.shift()) {
      const n = part.n;
      const onBytes = (sent: number) => {
        inFlight.set(n, sent);
        report(inFlight);
      };
      const etag = await sendPart(part, session, { file, deps, signal: pool.signal, onBytes });
      inFlight.delete(n);
      session.state.doneParts = [...session.state.doneParts, { n, etag }];
      await deps.store.save(session.key, session.state);
      report(inFlight);
    }
  }

  try {
    const workers = Array.from({ length: deps.concurrency }, () => worker().catch((e: unknown) => {
      stop(); // one failed part stops the others; the saved state keeps finished parts
      throw e;
    }));
    await Promise.all(workers);
  } finally {
    signal.removeEventListener('abort', stop);
  }
}

/**
 * Uploads `file`, resuming earlier work for the same fingerprint when the server still has it.
 * @param file - The picked file.
 * @param deps - Ports and limits.
 * @param onProgress - Called with bytes uploaded or in flight, after every change.
 * @param signal - Aborts the upload; finished parts stay saved for a later resume.
 * @returns The clip id of the registered clip.
 * @throws ApiError from the API or S3; a DOMException `AbortError` when `signal` aborts.
 */
export async function uploadFile(
  file: File,
  deps: UploadFileDeps,
  onProgress: (progress: UploadProgress) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ clipId: string }> {
  const session = (await resumeSession(file, deps)) ?? (await startSession(file, deps));
  const report = (inFlight: Map<number, number>) => {
    let loaded = bytesDone(session.plan, session.state.doneParts);
    for (const sent of inFlight.values()) loaded += sent;
    onProgress({
      loadedBytes: Math.min(loaded, file.size),
      resumed: session.resumed,
      partsDone: session.state.doneParts.length,
      partsTotal: session.plan.length,
    });
  };
  report(new Map());
  await sendMissingParts(file, session, deps, report, signal);

  const parts: CompletedPart[] = [...session.state.doneParts].sort((a, b) => a.n - b.n);
  try {
    await deps.api.completeUpload(session.state.uploadId, parts);
  } catch (error) {
    if (error instanceof ApiError && error.code === ERROR.UPLOAD_INCOMPLETE) {
      await deps.store.remove(session.key); // saved parts disagree with S3: next try starts over
    }
    throw error;
  }
  await deps.store.remove(session.key);
  return { clipId: session.state.clipId };
}
