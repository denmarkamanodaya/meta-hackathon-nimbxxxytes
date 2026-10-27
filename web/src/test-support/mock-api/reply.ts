// Reply builders the mock API's route tables share.
import type { ScheduledEvent } from './short-replay';

/** What the plugin should send back. */
export type MockReply =
  | { kind: 'json'; status: number; body: unknown; delayMs: number }
  | { kind: 'empty'; status: number }
  /** `closeMs`: when the server closes the stream; absent keeps it open (EventSource streams). */
  | { kind: 'sse'; events: ScheduledEvent[]; loopMs: number | null; closeMs?: number };

/**
 * A JSON answer.
 * @param body - The body.
 * @param delayMs - Simulated latency.
 * @param status - HTTP status.
 * @returns The reply.
 */
export const json = (body: unknown, delayMs = 250, status = 200): MockReply => ({ kind: 'json', status, body, delayMs });

/**
 * An error envelope.
 * @param status - HTTP status.
 * @param code - The error code.
 * @param message - The message.
 * @returns The reply.
 */
export const fail = (status: number, code: string, message: string): MockReply =>
  json({ error: { code, message } }, 150, status);

/** A request as the plugin hands it over; `path` is after `/api`. */
export interface MockRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

/** One route: method, path pattern, answer. */
export type MockRoute = [string, RegExp, (match: RegExpMatchArray, request: MockRequest) => MockReply];
