// Port: how the API client reaches the server. The PWA sends same-origin fetch and EventSource
// (services/api/fetch-transport.ts); the Mac app sends Tauri invoke calls that the native side
// forwards with the Keychain session (services/desktop/invoke-transport.ts).

/** HTTP methods the API uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** One API request, transport-neutral. */
export interface TransportRequest {
  method: HttpMethod;
  /** Path under the API root, with a leading slash and any query (`/clips`, `/people?prefix=a`). */
  path: string;
  /** Request body, already serialised; absent for no body. */
  body?: string;
  /** Media type of `body` (`application/json`); absent when there is no body. */
  contentType?: string;
  /** Caller cancellation; a cancelled call rejects with the signal's own reason. */
  signal?: AbortSignal | undefined;
}

/** The server's answer, whatever its status. */
export interface TransportResponse {
  /** HTTP status code. */
  status: number;
  /** Raw body text; empty for no body (204, 304). */
  body: string;
  /** The `Content-Type` header, or null when absent. */
  contentType: string | null;
}

/**
 * Sends API requests and opens Server-Sent Event streams.
 * `send` resolves for every HTTP status; it rejects only when no answer arrived (a typed
 * `TIMEOUT` / `NETWORK_ERROR` failure, or the caller's abort reason unchanged).
 */
export interface ApiTransport {
  /** Sends one request. */
  send(request: TransportRequest): Promise<TransportResponse>;
  /**
   * Opens an SSE stream under the API root and delivers each unnamed event's `data`.
   * @returns A function that closes the stream for good.
   */
  openStream(path: string, onData: (data: string) => void): () => void;
}
