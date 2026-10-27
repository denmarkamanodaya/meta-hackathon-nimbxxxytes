// Reads an API answer's body: JSON when there is any, and the { error: { code, message } }
// envelope of a refusal as a typed `ApiError`. Shared by plain requests and request streams.
import { ApiError } from './api-error';
import { isErrorCode } from './types';

/**
 * Parses a body as JSON.
 * @param text - Raw body; empty for none.
 * @returns The value, or undefined for an empty or non-JSON body.
 */
export function readJson(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Recovers: a non-JSON body is reported by the caller as BAD_RESPONSE.
    return undefined;
  }
}

/**
 * Turns a refusal into a typed failure.
 * @param status - HTTP status of the refusal.
 * @param body - Its parsed body.
 * @returns `ApiError` with the envelope's code, or `BAD_RESPONSE` without a known one.
 */
export function errorFromBody(status: number, body: unknown): ApiError {
  const error = typeof body === 'object' && body !== null && 'error' in body ? body.error : null;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return new ApiError('BAD_RESPONSE', `HTTP ${String(status)} without an error body`, status);
  }
  const code = String(error.code);
  const message = 'message' in error && typeof error.message === 'string' ? error.message : code;
  if (!isErrorCode(code)) {
    return new ApiError('BAD_RESPONSE', `Unknown error code ${code}: ${message}`, status);
  }
  return new ApiError(code, message, status);
}
