// Live editing-agent steps for one short over Server-Sent Events (`GET /shorts/{id}/events`).
import { parseStep } from '../api/parse-shorts';
import type { AgentStep } from '../api/types';
import { browserEventSource, eventSourceStream, openSse, type EventSourceFactory, type OpenStream } from './sse';

/**
 * Subscribes to one short's agent steps.
 * @returns An unsubscribe function that closes the stream.
 */
export type ShortStepSource = (shortId: string, onStep: (step: AgentStep) => void) => () => void;

const parseStepData = (data: string): AgentStep | null => {
  try {
    return parseStep(JSON.parse(data));
  } catch {
    return null; // Recovers: a malformed event is skipped; polling still has the full log.
  }
};

/**
 * Builds the SSE subscriber over any stream opener (the API transport's `openStream`). The
 * stream closes after the `final` step.
 * @param open - Stream opener.
 * @returns The subscriber.
 */
export function shortStepSourceOver(open: OpenStream): ShortStepSource {
  return (shortId, onStep) =>
    openSse(open, {
      path: `/shorts/${encodeURIComponent(shortId)}/events`,
      parse: parseStepData,
      isFinal: (step) => step.kind === 'final',
      onEvent: onStep,
    });
}

/**
 * Builds the subscriber over the browser's EventSource (what the PWA transport streams with).
 * @param baseUrl - API base (`/api`).
 * @param create - EventSource constructor wrapper; defaults to the browser's.
 * @returns The subscriber.
 */
export function createShortStepSource(
  baseUrl: string,
  create: EventSourceFactory = browserEventSource,
): ShortStepSource {
  return shortStepSourceOver(eventSourceStream(baseUrl, create));
}
