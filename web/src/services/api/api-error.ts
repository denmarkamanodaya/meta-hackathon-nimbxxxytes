// The typed failure every API and storage call rejects with; one home so transports and the
// client share it.
import type { ErrorCode } from './types';

/**
 * Failures raised on the client side, not sent by the API.
 * `PART_FAILED` / `ETAG_MISSING` come from the S3 part upload (`services/upload/put-part.ts`);
 * `DESKTOP_FAILED` from a native call in the Mac app (`services/desktop/`).
 */
export type ClientErrorCode =
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'BAD_RESPONSE'
  | 'PART_FAILED'
  | 'ETAG_MISSING'
  | 'DESKTOP_FAILED';

/**
 * Typed failure of an API or storage call.
 * `code` is an API `ErrorCode` when the server sent a known envelope, else a `ClientErrorCode`.
 * `status` is the HTTP status, or null when no response arrived.
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';

  /**
   * @param code - Stable `UPPER_SNAKE` code callers switch on.
   * @param message - Human-readable detail; may change.
   * @param status - HTTP status, or null without a response.
   */
  constructor(
    readonly code: ErrorCode | ClientErrorCode,
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}
