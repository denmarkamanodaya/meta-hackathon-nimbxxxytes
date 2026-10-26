// Shared Server-Sent Events plumbing: open a stream with the session cookie, parse each
// unnamed event, and close for good once the caller says the last event arrived.

/** The EventSource surface this module uses; tests inject a fake. */
export type EventSourceFactory = (url: string, init: EventSourceInit) => EventSource;

/** The browser's EventSource constructor. */
export const browserEventSource: EventSourceFactory = (url, init) => new EventSource(url, init);

/** How to read one stream. */
export interface SseStream<T> {
  url: string;
  /** Parses `data`; null skips a malformed event. */
  parse: (data: string) => T | null;
  /** True for the last event; the stream then closes instead of reconnecting. */
  isFinal: (event: T) => boolean;
  onEvent: (event: T) => void;
}

/**
 * Opens one stream. The browser reconnects by itself after a dropped connection.
 * @param create - EventSource factory.
 * @param stream - URL, parser, end rule and listener.
 * @returns A function that closes the stream.
 */
export function openSse<T>(create: EventSourceFactory, stream: SseStream<T>): () => void {
  const source = create(stream.url, { withCredentials: true });
  source.onmessage = (message: MessageEvent<string>) => {
    const event = stream.parse(message.data);
    if (event === null) return;
    stream.onEvent(event);
    if (stream.isFinal(event)) source.close();
  };
  return () => {
    source.close();
  };
}
