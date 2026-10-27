// `POST /search/stream` (v1.1): local results first, then the Muse Spark order with reasons (or
// an `error` event instead, which leaves the local results standing), then `done`. A server
// without the route (404), a GET of it (405) or a stream that breaks before its first stage
// (an older Mac app native side sends the stream as a GET and reports the refusal only as text)
// falls back to the plain `POST /search`, so search always works. Any other refusal is the
// search's own error and is shown; a stream that breaks after a stage never repeats the paid
// search.
import type { ApiTransport, TransportResponse } from '../../core/ports/api-transport';
import { parseSearchStage } from './parse-search';
import { errorFromBody, readJson } from './read-answer';
import type { SearchResponse, SearchStage } from './types';

/** Statuses that mean "this server cannot stream the search": no such route, or wrong method. */
const NO_STREAM_STATUSES: readonly number[] = [404, 405];

/** What the stream search needs from the client. */
export interface SearchStreamDeps {
  transport: ApiTransport;
  /** The plain `POST /search`, used when the stream cannot deliver. */
  search: (query: string, signal?: AbortSignal) => Promise<SearchResponse>;
  /** Called on a 401 before the call rejects. */
  onUnauthorized?: (() => void) | undefined;
}

/**
 * Runs one streamed search.
 * @param deps - Transport, the plain search, the 401 callback.
 * @param query - The query as typed.
 * @param onStage - Gets each stage in arrival order: `local`, then `ranked`. The fallback
 *   delivers its answer as `ranked`.
 * @param signal - Caller cancellation; an abort rejects with the signal's reason and never
 *   falls back.
 * @returns Resolves once the stream ended, rejects with `ApiError` (a refusal other than 404 /
 *   405, a failure after a stage arrived, or the fallback's own failure).
 */
export async function streamSearch(
  deps: SearchStreamDeps,
  query: string,
  onStage: (stage: SearchStage) => void,
  signal?: AbortSignal,
): Promise<void> {
  // An object, not a `let`: the flag is set inside the event callback.
  const progress = { hasStage: false };
  let answer: TransportResponse | null = null;
  try {
    answer = await deps.transport.streamRequest(
      { method: 'POST', path: '/search/stream', body: JSON.stringify({ query }), contentType: 'application/json', signal },
      (event) => {
        const stage = parseSearchStage(event);
        if (stage === null) return;
        progress.hasStage = true;
        onStage(stage);
      },
    );
  } catch (thrown) {
    if (progress.hasStage || signal?.aborted === true) throw thrown;
  }
  if (answer !== null && (answer.status < 200 || answer.status > 299) && !NO_STREAM_STATUSES.includes(answer.status)) {
    if (answer.status === 401) deps.onUnauthorized?.();
    throw errorFromBody(answer.status, readJson(answer.body));
  }
  if (progress.hasStage) return;
  onStage({ stage: 'ranked', response: await deps.search(query, signal) });
}
