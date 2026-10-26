// Live ingest progress for one clip over Server-Sent Events (`GET /clips/{id}/events`).
import { parseClipEvent } from '../api/parse-clip-detail';
import type { ClipEvent } from '../api/types';
import { browserEventSource, openSse, type EventSourceFactory } from './sse';

export type { EventSourceFactory } from './sse';

/**
 * Subscribes to one clip's step events.
 * @returns An unsubscribe function that closes the stream.
 */
export type ClipEventSource = (clipId: string, onEvent: (event: ClipEvent) => void) => () => void;

/**
 * Builds the SSE subscriber. The stream closes for good once the `ready` step is done or a step
 * fails, since nothing follows those.
 * @param baseUrl - API base, as for the HTTP client (`/api`).
 * @param create - EventSource constructor wrapper; defaults to the browser's.
 * @returns The subscriber.
 */
export function createClipEventSource(
  baseUrl: string,
  create: EventSourceFactory = browserEventSource,
): ClipEventSource {
  return (clipId, onEvent) =>
    openSse(create, {
      url: `${baseUrl}/clips/${encodeURIComponent(clipId)}/events`,
      parse: parseClipEvent,
      isFinal: (event) => event.status === 'failed' || (event.step === 'ready' && event.status === 'done'),
      onEvent,
    });
}
