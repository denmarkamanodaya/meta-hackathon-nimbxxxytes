// PWA transport: same-origin fetch with the session cookie, and EventSource for SSE. The only
// fetch caller for the API, so the cookie and timeout rules live here.
import type { ApiTransport, TransportResponse } from '../../core/ports/api-transport';
import { browserEventSource, eventSourceStream, type EventSourceFactory } from '../events/sse';
import { ApiError } from './api-error';

/** Settings for `createFetchTransport`. */
export interface FetchTransportOptions {
  /** Base path or origin of the API, without a trailing slash (`/api`). */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Fetch implementation; defaults to the global `fetch`. Tests inject a fake. */
  fetchFn?: typeof fetch | undefined;
  /** EventSource factory; defaults to the browser's. */
  createEventSource?: EventSourceFactory;
}

function errorFromThrown(thrown: unknown, callerSignal: AbortSignal | undefined): unknown {
  if (callerSignal?.aborted === true) return thrown; // caller cancelled: rethrow as-is
  if (thrown instanceof DOMException && thrown.name === 'TimeoutError') {
    return new ApiError('TIMEOUT', 'The server took too long to answer', null);
  }
  return new ApiError('NETWORK_ERROR', 'Could not reach the server', null);
}

async function readText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    // Recovers: an unreadable body reads as empty; the client reports it as BAD_RESPONSE.
    return '';
  }
}

/**
 * Builds the fetch transport. Every request asks for JSON and sends the session cookie
 * (`credentials: 'include'`).
 * @param options - Base URL, timeout and optional fetch / EventSource doubles.
 * @returns The transport.
 */
export function createFetchTransport(options: FetchTransportOptions): ApiTransport {
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));
  return {
    send: async ({ method, path, body, contentType, signal }): Promise<TransportResponse> => {
      const timeout = AbortSignal.timeout(options.timeoutMs);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (contentType !== undefined) headers['Content-Type'] = contentType;
      let response: Response;
      try {
        response = await fetchFn(`${options.baseUrl}${path}`, {
          method,
          credentials: 'include',
          headers,
          ...(body === undefined ? {} : { body }),
          signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        });
      } catch (thrown) {
        throw errorFromThrown(thrown, signal);
      }
      return {
        status: response.status,
        body: await readText(response),
        contentType: response.headers.get('Content-Type'),
      };
    },
    openStream: eventSourceStream(options.baseUrl, options.createEventSource ?? browserEventSource),
  };
}
