// The Mac app's web layer in a plain browser (`npm run dev:desktop-mock`): the real desktop
// platform and its invoke adapters, over a fake Tauri IPC that forwards `api_request` and
// `api_stream` to the mock API through the fetch transport, as the native side forwards them to
// the server. Dev
// only; never part of a build. `localStorage['mock-native'] = 'get-only'` makes `api_stream`
// ignore `method` and `body`, like a native side from before the request-stream contract.
import { mockConvertFileSrc, mockIPC } from '@tauri-apps/api/mocks';
import type { HttpMethod, TransportRequest } from '../../core/ports/api-transport';
import { createFetchTransport } from '../../services/api/fetch-transport';
import syncStatus from '../fixtures/sync-status.json';

/** What a fake Channel argument carries: the id its messages are delivered to. */
interface ChannelArg {
  id: number;
}

/** The mocked Tauri internals `mockIPC` installs. */
interface MockedInternals {
  runCallback: (id: number, data: unknown) => void;
}

const internals = () => (window as unknown as { __TAURI_INTERNALS__: MockedInternals }).__TAURI_INTERNALS__;

const isGetOnlyNative = (): boolean => {
  try {
    return window.localStorage.getItem('mock-native') === 'get-only';
  } catch {
    return false; // Recovers: storage blocked; act as the current native side.
  }
};

const streams = new Map<string, AbortController>();
let nextStreamId = 1;

/** The native side's HTTP client: the PWA transport over the same origin, full `/api` paths. */
const http = createFetchTransport({ baseUrl: '', timeoutMs: 60_000 });

/** A bridge call's flat args as a transport request (the native side does the same mapping). */
function toRequest(args: Record<string, unknown>, isGetOnly: boolean, signal?: AbortSignal): TransportRequest {
  const method = !isGetOnly && typeof args.method === 'string' ? (args.method as HttpMethod) : 'GET';
  return {
    method,
    path: String(args.path),
    ...(!isGetOnly && typeof args.body === 'string' ? { body: args.body } : {}),
    ...(!isGetOnly && typeof args.content_type === 'string' ? { contentType: args.content_type } : {}),
    signal,
  };
}

async function apiRequest(args: Record<string, unknown>) {
  const response = await http.send(toRequest(args, false));
  return { status: response.status, body: response.body, content_type: response.contentType };
}

/** Pumps one stream into the channel, then sends `__end` as the native side does. */
async function pump(args: Record<string, unknown>, channel: ChannelArg, signal: AbortSignal) {
  let index = 0;
  const send = (message: { event: string | null; data: string }) => {
    internals().runCallback(channel.id, { index, message });
    index += 1;
  };
  try {
    const response = await http.streamRequest(toRequest(args, isGetOnlyNative(), signal), send);
    const isOk = response.status >= 200 && response.status <= 299;
    send({ event: '__end', data: isOk ? '' : `server answered ${String(response.status)}` });
  } catch (thrown) {
    if (!signal.aborted) send({ event: '__end', data: thrown instanceof Error ? thrown.message : 'network' });
  }
}

function apiStream(args: Record<string, unknown>) {
  const streamId = `mock-${String(nextStreamId)}`;
  nextStreamId += 1;
  const controller = new AbortController();
  streams.set(streamId, controller);
  void pump(args, args.on_event as ChannelArg, controller.signal).finally(() => {
    streams.delete(streamId);
  });
  return { stream_id: streamId };
}

mockConvertFileSrc('macos');
mockIPC(
  (command, payload) => {
    const args = (payload ?? {}) as Record<string, unknown>;
    switch (command) {
      case 'api_request':
        return apiRequest(args);
      case 'api_stream':
        return apiStream(args);
      case 'api_stream_cancel':
        streams.get(String(args.stream_id))?.abort();
        return null;
      case 'server_get':
        return { url: window.location.origin };
      case 'folder_get':
        return { path: syncStatus.folder };
      case 'sync_status':
        return syncStatus;
      case 'media_lookup':
        return { path: null };
      default:
        return null;
    }
  },
  { shouldMockEvents: true },
);

export { createPlatform } from '../../app/platform/desktop';
