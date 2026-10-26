// Live ingest progress for one clip over Server-Sent Events (`GET /clips/{id}/events`).
// The only module that opens an EventSource.
import { parseClipEvent } from '../api/parse-clip-detail';
import type { ClipEvent } from '../api/types';

/**
 * Subscribes to one clip's step events.
 * @returns An unsubscribe function that closes the stream.
 */
export type ClipEventSource = (clipId: string, onEvent: (event: ClipEvent) => void) => () => void;

/** The EventSource surface this module uses; tests inject a fake. */
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

/**
 * Builds the SSE subscriber.
 * The browser reconnects on its own after a dropped stream; the stream closes for good once the
 * `ready` step is done or a step fails, since nothing follows those.
 * @param baseUrl - API base, as for the HTTP client (`/api`).
 * @param create - EventSource constructor wrapper; defaults to the browser's.
 * @returns The subscriber.
 */
export function createClipEventSource(
  baseUrl: string,
  create: EventSourceFactory = (url, init) => new EventSource(url, init),
): ClipEventSource {
  return (clipId, onEvent) => {
    const url = `${baseUrl}/clips/${encodeURIComponent(clipId)}/events`;
    const source = create(url, { withCredentials: true });
    source.onmessage = (message: MessageEvent<string>) => {
      const event = parseClipEvent(message.data);
      if (event === null) return;
      onEvent(event);
      const isFinal = event.status === 'failed' || (event.step === 'ready' && event.status === 'done');
      if (isFinal) source.close();
    };
    return () => {
      source.close();
    };
  };
}
