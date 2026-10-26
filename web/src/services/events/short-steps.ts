// Live editing-agent steps for one short over Server-Sent Events (`GET /shorts/{id}/events`).
import { parseStep } from '../api/parse-shorts';
import type { AgentStep } from '../api/types';
import { browserEventSource, openSse, type EventSourceFactory } from './sse';

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
 * Builds the SSE subscriber. The stream closes after the `final` step.
 * @param baseUrl - API base (`/api`).
 * @param create - EventSource constructor wrapper; defaults to the browser's.
 * @returns The subscriber.
 */
export function createShortStepSource(
  baseUrl: string,
  create: EventSourceFactory = browserEventSource,
): ShortStepSource {
  return (shortId, onStep) =>
    openSse(create, {
      url: `${baseUrl}/shorts/${encodeURIComponent(shortId)}/events`,
      parse: parseStepData,
      isFinal: (step) => step.kind === 'final',
      onEvent: onStep,
    });
}
