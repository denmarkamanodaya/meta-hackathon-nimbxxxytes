// PWA transport: same-origin fetch with the session cookie, EventSource for GET streams and a
// streamed fetch body for POST streams. The only fetch caller for the API, so the cookie and
// timeout rules live here.
import type {
  ApiTransport,
  StreamEvent,
  TransportRequest,
  TransportResponse,
} from '../../core/ports/api-transport';
import { browserEventSource, eventSourceStream, type EventSourceFactory } from '../events/sse';
import { createSseParser } from '../events/sse-parser';
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

/** Decodes a streamed body and hands each completed SSE event to `onEvent`. */
async function pumpEvents(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) onEvent(event);
  }
  for (const event of parser.push(decoder.decode())) onEvent(event);
}

/**
 * Builds the fetch transport. Every request sends the session cookie (`credentials: 'include'`)
 * and asks for JSON, or for `text/event-stream` on a stream request. `timeoutMs` bounds a whole
 * stream, not only its first byte.
 * @param options - Base URL, timeout and optional fetch / EventSource doubles.
 * @returns The transport.
 */
export function createFetchTransport(options: FetchTransportOptions): ApiTransport {
  const fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init));

  async function open(request: TransportRequest, accept: string, timeout: AbortSignal): Promise<Response> {
    const { method, path, body, contentType, signal } = request;
    const headers: Record<string, string> = { Accept: accept };
    if (contentType !== undefined) headers['Content-Type'] = contentType;
    try {
      return await fetchFn(`${options.baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers,
        ...(body === undefined ? {} : { body }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
      });
    } catch (thrown) {
      throw errorFromThrown(thrown, signal);
    }
  }

  const answer = async (response: Response): Promise<TransportResponse> => ({
    status: response.status,
    body: await readText(response),
    contentType: response.headers.get('Content-Type'),
  });

  return {
    send: async (request) =>
      answer(await open(request, 'application/json', AbortSignal.timeout(options.timeoutMs))),
    streamRequest: async (request, onEvent) => {
      const response = await open(request, 'text/event-stream', AbortSignal.timeout(options.timeoutMs));
      if (!response.ok || response.body === null) return answer(response);
      try {
        await pumpEvents(response.body, onEvent);
      } catch (thrown) {
        throw errorFromThrown(thrown, request.signal);
      }
      return { status: response.status, body: '', contentType: response.headers.get('Content-Type') };
    },
    openStream: eventSourceStream(options.baseUrl, options.createEventSource ?? browserEventSource),
  };
}
