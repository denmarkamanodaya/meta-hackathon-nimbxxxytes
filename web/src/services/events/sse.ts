// Shared Server-Sent Events plumbing: open a stream through the API transport, parse each
// unnamed event, and close for good once the caller says the last event arrived.

/** The EventSource surface this module uses; tests inject a fake. */
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

/** The browser's EventSource constructor. */
export const browserEventSource: EventSourceFactory = (url, init) => new EventSource(url, init);

/**
 * Opens a stream at `path` under the API root and delivers each unnamed event's `data`.
 * The same shape as `ApiTransport.openStream`.
 * @returns A function that closes the stream.
 */
export type OpenStream = (path: string, onData: (data: string) => void) => () => void;

/**
 * Streams over the browser's EventSource with the session cookie. The browser reconnects by
 * itself after a dropped connection.
 * @param baseUrl - API base (`/api`), joined with each path.
 * @param create - EventSource factory.
 * @returns The opener.
 */
export function eventSourceStream(baseUrl: string, create: EventSourceFactory): OpenStream {
  return (path, onData) => {
    const source = create(`${baseUrl}${path}`, { withCredentials: true });
    source.onmessage = (message: MessageEvent<string>) => {
      onData(message.data);
    };
    return () => {
      source.close();
    };
  };
}

/** How to read one stream. */
export interface SseStream<T> {
  /** Path under the API root (`/clips/c1/events`). */
  path: string;
  /** Parses `data`; null skips a malformed event. */
  parse: (data: string) => T | null;
  /** True for the last event; the stream then closes instead of reconnecting. */
  isFinal: (event: T) => boolean;
  onEvent: (event: T) => void;
}

/**
 * Opens one stream.
 * @param open - Stream opener (the API transport's `openStream`).
 * @param stream - Path, parser, end rule and listener.
 * @returns A function that closes the stream.
 */
export function openSse<T>(open: OpenStream, stream: SseStream<T>): () => void {
  // An opener may deliver the final event before it returns; `state` lets close run either way.
  const state: { isClosed: boolean; closeStream: (() => void) | null } = { isClosed: false, closeStream: null };
  const close = () => {
    state.isClosed = true;
    state.closeStream?.();
  };
  const closeStream = open(stream.path, (data) => {
    if (state.isClosed) return;
    const event = stream.parse(data);
    if (event === null) return;
    stream.onEvent(event);
    if (stream.isFinal(event)) close();
  });
  state.closeStream = closeStream;
  if (state.isClosed) closeStream();
  return close;
}
