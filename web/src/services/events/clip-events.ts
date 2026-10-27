// Live ingest progress for one clip over Server-Sent Events (`GET /clips/{id}/events`).
import { parseClipEvent } from '../api/parse-clip-detail';
import type { ClipEvent } from '../api/types';
import { browserEventSource, eventSourceStream, openSse, type EventSourceFactory, type OpenStream } from './sse';

export type { EventSourceFactory } from './sse';

/**
 * Subscribes to one clip's step events.
 * @returns An unsubscribe function that closes the stream.
 */
export type ClipEventSource = (clipId: string, onEvent: (event: ClipEvent) => void) => () => void;

/**
 * Builds the SSE subscriber over any stream opener (the API transport's `openStream`). The
 * stream closes for good once the `ready` step is done or a step fails, since nothing follows.
 * @param open - Stream opener.
 * @returns The subscriber.
 */
export function clipEventSourceOver(open: OpenStream): ClipEventSource {
  return (clipId, onEvent) =>
    openSse(open, {
      path: `/clips/${encodeURIComponent(clipId)}/events`,
      parse: parseClipEvent,
      isFinal: (event) => event.status === 'failed' || (event.step === 'ready' && event.status === 'done'),
      onEvent,
    });
}

/**
 * Builds the subscriber over the browser's EventSource (what the PWA transport streams with).
 * @param baseUrl - API base, as for the HTTP client (`/api`).
 * @param create - EventSource constructor wrapper; defaults to the browser's.
 * @returns The subscriber.
 */
export function createClipEventSource(
  baseUrl: string,
  create: EventSourceFactory = browserEventSource,
): ClipEventSource {
  return clipEventSourceOver(eventSourceStream(baseUrl, create));
}
