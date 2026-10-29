// Live steps of a short's publish run over Server-Sent Events (`GET /shorts/{id}/exports/events`).
// The stream ends after `done` or any failed step.
import { parseStudioStep } from '../api/parse-studio';
import type { StudioStepEvent } from '../api/types';
import { openSse, type OpenStream } from './sse';

/**
 * Subscribes to one run's steps.
 * @returns An unsubscribe function that closes the stream.
 */
export type StudioStepSource = (id: string, onStep: (event: StudioStepEvent) => void) => () => void;

/**
 * True for the last event of a run: `done`, or any failed step.
 * @param event - A step event.
 * @returns Whether the stream ends after it.
 */
export const isLastStudioStep = (event: StudioStepEvent): boolean =>
  event.status === 'failed' || (event.step === 'done' && event.status === 'done');

function sourceOver(open: OpenStream, pathOf: (id: string) => string): StudioStepSource {
  return (id, onStep) => openSse(open, { path: pathOf(id), parse: parseStudioStep, isFinal: isLastStudioStep, onEvent: onStep });
}

/**
 * A short's publish and cover steps.
 * @param open - Stream opener.
 * @returns The subscriber, keyed by short id.
 */
export const exportStepSourceOver = (open: OpenStream): StudioStepSource =>
  sourceOver(open, (id) => `/shorts/${encodeURIComponent(id)}/exports/events`);
