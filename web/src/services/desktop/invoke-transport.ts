// Mac app transport: API requests and SSE streams travel as Tauri invoke calls; the native side
// adds the Keychain session cookie and stores a new one (contract: `api_request`, `api_stream`,
// `api_stream_cancel`). The server answer comes back whatever its status, as fetch does; only
// transport problems reject, with a native `{ code, message }`. A request stream
// (`POST /search/stream`) passes `method`, `body` and `content_type` to `api_stream` as well; a
// native side that ignores them sends a GET, which the server refuses (405), and the client then
// falls back to the plain request. A binary body (a voice note) goes as `body_base64` text.
import type {
  ApiTransport,
  StreamEvent,
  TransportRequest,
  TransportResponse,
} from '../../core/ports/api-transport';
import { ApiError, type ClientErrorCode } from '../api/api-error';
import { isNumber, isNullable, isRecord, isString } from '../api/json-guards';
import { blobToBase64 } from './body-base64';
import { readNativeFailure } from './native-error';
import type { TauriIpc } from './tauri-bridge';

/** The native side forwards only paths under this prefix (the server's API root). */
const API_PREFIX = '/api';

/** End-of-stream marker the native side sends as the last channel message. */
const END_EVENT = '__end';

/**
 * Wait before reopening a stream that ended early, in ms. The native side never reconnects, so
 * this mirrors the browser EventSource's own default retry.
 */
export const STREAM_RETRY_MS = 3000;

/** Native `api_request` codes with a client meaning of their own; the rest are DESKTOP_FAILED. */
const REQUEST_CODES: Partial<Record<string, ClientErrorCode>> = {
  NETWORK: 'NETWORK_ERROR',
  BAD_RESPONSE: 'BAD_RESPONSE',
};

function requestError(thrown: unknown): ApiError {
  const failure = readNativeFailure(thrown, 'the app could not send the request');
  if (failure.code === null) {
    return new ApiError('NETWORK_ERROR', `Could not reach the server: ${failure.message}`, null);
  }
  return new ApiError(REQUEST_CODES[failure.code] ?? 'DESKTOP_FAILED', failure.message, null);
}

/** One channel message of `api_stream`. */
interface StreamMessage {
  event: string | null;
  data: string;
}

const parseStreamMessage = (value: unknown): StreamMessage | null =>
  isRecord(value) && isNullable(value.event, isString) && isString(value.data)
    ? { event: value.event, data: value.data }
    : null;

const streamIdOf = (value: unknown): string | null =>
  isRecord(value) && isString(value.stream_id) ? value.stream_id : null;

function parseResponse(value: unknown): TransportResponse | null {
  if (!isRecord(value) || !isNumber(value.status) || !isString(value.body)) return null;
  if (!isNullable(value.content_type, isString)) return null;
  return { status: value.status, body: value.body, contentType: value.content_type };
}

/** Rejects when `signal` aborts: the caller's reason when it is the caller's, else TIMEOUT. */
function whenAborted(timeout: AbortSignal, caller: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => {
      if (caller?.aborted === true) reject(caller.reason as Error);
      else reject(new ApiError('TIMEOUT', 'The server took too long to answer', null));
    };
    timeout.addEventListener('abort', onAbort, { once: true });
    caller?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Stops a native stream; a stream already gone is fine. */
function cancelStream(ipc: TauriIpc, streamId: string): void {
  ipc.invoke('api_stream_cancel', { stream_id: streamId }).catch(() => {
    // Recovers: the stream is already gone on the native side; nothing is left to close.
  });
}

/** Args the native side reads to send a stream request with a method and body. */
function streamArgs(request: TransportRequest): Record<string, unknown> {
  const { method, path, body, contentType } = request;
  return {
    path: `${API_PREFIX}${path}`,
    method,
    ...(body === undefined ? {} : { body }),
    ...(contentType === undefined ? {} : { content_type: contentType }),
  };
}

/**
 * One request stream over `api_stream`: events until `__end`, never reopened. The native side
 * reports a refusal only as the `__end` text, so a stream that ends with text rejects
 * `DESKTOP_FAILED` (the HTTP status is not known here).
 */
function streamOnce(
  ipc: TauriIpc,
  timeoutMs: number,
  request: TransportRequest,
  onEvent: (event: StreamEvent) => void,
): Promise<TransportResponse> {
  const { signal } = request;
  if (signal?.aborted === true) return Promise.reject(signal.reason as Error);
  return new Promise<TransportResponse>((resolve, reject) => {
    const state = { isOpen: true, isCancelled: false, streamId: null as string | null };
    const timeout = AbortSignal.timeout(timeoutMs);
    const finish = (settle: () => void) => {
      if (!state.isOpen) return;
      state.isOpen = false;
      timeout.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', onAbort);
      settle();
    };
    const cancel = () => {
      state.isCancelled = true;
      if (state.streamId !== null) cancelStream(ipc, state.streamId);
    };
    function onAbort() {
      finish(() => {
        cancel();
        if (signal?.aborted === true) reject(signal.reason as Error);
        else reject(new ApiError('TIMEOUT', 'The server took too long to answer', null));
      });
    }
    timeout.addEventListener('abort', onAbort, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    const channel = ipc.channel((raw) => {
      const message = parseStreamMessage(raw);
      if (!state.isOpen || message === null) return;
      if (message.event !== END_EVENT) {
        onEvent(message);
        return;
      }
      finish(() => {
        if (message.data === '') resolve({ status: 200, body: '', contentType: 'text/event-stream' });
        else reject(new ApiError('DESKTOP_FAILED', message.data, null));
      });
    });
    ipc.invoke('api_stream', { ...streamArgs(request), on_event: channel }).then(
      (opened) => {
        state.streamId = streamIdOf(opened);
        if (state.isCancelled) cancel();
      },
      (thrown: unknown) => {
        finish(() => {
          reject(requestError(thrown));
        });
      },
    );
  });
}

/**
 * Builds the invoke transport.
 * @param ipc - Tauri IPC (the real one, or a fake in tests).
 * @param timeoutMs - Per-request timeout in milliseconds; the native call itself keeps running.
 * @returns The transport.
 */
export function createInvokeTransport(ipc: TauriIpc, timeoutMs: number): ApiTransport {
  async function call({ method, path, body, bytes, contentType }: Parameters<ApiTransport['send']>[0]) {
    let answer: unknown;
    try {
      answer = await ipc.invoke('api_request', {
        method,
        path: `${API_PREFIX}${path}`,
        ...(body === undefined ? {} : { body }),
        ...(bytes === undefined ? {} : { body_base64: await blobToBase64(bytes) }),
        ...(contentType === undefined ? {} : { content_type: contentType }),
      });
    } catch (thrown) {
      throw requestError(thrown);
    }
    const response = parseResponse(answer);
    if (response === null) throw new ApiError('BAD_RESPONSE', `Unexpected native answer for ${path}`, null);
    return response;
  }

  return {
    send: (request) => {
      if (request.signal?.aborted === true) return Promise.reject(request.signal.reason as Error);
      return Promise.race([call(request), whenAborted(AbortSignal.timeout(request.timeoutMs ?? timeoutMs), request.signal)]);
    },
    streamRequest: (request, onEvent) => streamOnce(ipc, timeoutMs, request, onEvent),
    openStream: (path, onData) => {
      let isOpen = true;
      let streamId: string | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const cancel = (id: string) => {
        cancelStream(ipc, id);
      };
      const reopenLater = () => {
        if (isOpen) retry = setTimeout(open, STREAM_RETRY_MS);
      };
      // Each attempt gets its own channel, so a late message of an ended attempt is ignored.
      function open() {
        let isCurrent = true;
        streamId = null;
        const channel = ipc.channel((raw) => {
          const message = parseStreamMessage(raw);
          if (!isOpen || !isCurrent || message === null) return;
          if (message.event === END_EVENT) {
            isCurrent = false;
            streamId = null;
            reopenLater();
            return;
          }
          if (message.event === null || message.event === 'message') onData(message.data);
        });
        ipc
          .invoke('api_stream', { path: `${API_PREFIX}${path}`, on_event: channel })
          .then((opened) => {
            const id = streamIdOf(opened);
            if (!isCurrent) return;
            streamId = id;
            if (!isOpen && id !== null) cancel(id);
          })
          .catch(() => {
            // Recovers: retried like a dropped EventSource; the pages poll the same data meanwhile.
            if (!isCurrent) return;
            isCurrent = false;
            reopenLater();
          });
      }
      open();
      return () => {
        if (!isOpen) return;
        isOpen = false;
        clearTimeout(retry);
        if (streamId !== null) cancel(streamId);
      };
    },
  };
}
