// Sends one part to its presigned S3 URL. Uses XMLHttpRequest, not fetch, because only XHR
// reports upload progress. S3 returns the part's ETag in a response header; the bucket's CORS
// rule must expose ETag or the browser hides it (reported as ETAG_MISSING).
import { ApiError } from '../api/client';

/**
 * Uploads `body` to `url` and resolves the ETag header.
 * `onProgress` receives bytes sent so far for this part. Rejects with `ApiError`
 * (`PART_FAILED` with the S3 status, `NETWORK_ERROR`, `TIMEOUT`, `ETAG_MISSING`) or, when
 * `signal` aborts, with a DOMException named `AbortError`.
 */
export type PutPart = (
  url: string,
  body: Blob,
  onProgress: (sentBytes: number) => void,
  signal: AbortSignal,
) => Promise<string>;

/**
 * Builds the XHR-based `PutPart`.
 * @param timeoutMs - Per-part timeout in milliseconds.
 * @param Xhr - XMLHttpRequest constructor; tests inject a fake.
 * @returns The part uploader.
 */
export function createXhrPutPart(
  timeoutMs: number,
  Xhr: typeof XMLHttpRequest = XMLHttpRequest,
): PutPart {
  return (url, body, onProgress, signal) =>
    new Promise((resolve, reject) => {
      const xhr = new Xhr();
      const abort = () => {
        xhr.abort();
      };
      const settle = () => {
        signal.removeEventListener('abort', abort);
      };
      xhr.open('PUT', url);
      xhr.timeout = timeoutMs;
      xhr.upload.onprogress = (event) => {
        onProgress(event.loaded);
      };
      xhr.onload = () => {
        settle();
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new ApiError('PART_FAILED', `S3 answered ${String(xhr.status)}`, xhr.status));
          return;
        }
        const etag = xhr.getResponseHeader('ETag');
        if (etag === null || etag === '') {
          reject(new ApiError('ETAG_MISSING', 'S3 ETag header not readable (CORS)', xhr.status));
          return;
        }
        resolve(etag);
      };
      xhr.onerror = () => {
        settle();
        reject(new ApiError('NETWORK_ERROR', 'Part upload lost the connection', null));
      };
      xhr.ontimeout = () => {
        settle();
        reject(new ApiError('TIMEOUT', 'Part upload timed out', null));
      };
      xhr.onabort = () => {
        settle();
        reject(new DOMException('Part upload aborted', 'AbortError'));
      };
      if (signal.aborted) {
        abort();
        return;
      }
      signal.addEventListener('abort', abort);
      xhr.send(body);
    });
}
