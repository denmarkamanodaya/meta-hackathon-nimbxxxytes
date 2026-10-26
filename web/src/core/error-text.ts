// Short human messages for error codes, shown in toasts next to the code itself.

const TEXT: Record<string, string> = {
  NETWORK_ERROR: 'You seem to be offline.',
  TIMEOUT: 'The server took too long.',
  BAD_RESPONSE: 'The server sent something unexpected.',
  PART_FAILED: 'Storage refused part of the file.',
  ETAG_MISSING: 'Storage did not confirm the upload.',
  NOT_FOUND: 'That no longer exists.',
  FORBIDDEN: 'That belongs to someone else.',
  UNAUTHORIZED: 'Your session ended. Unlock again.',
  VALIDATION_FAILED: 'Something in the request was not valid.',
  UPLOAD_INCOMPLETE: 'Some parts did not arrive. Retry the upload.',
  MODEL_UNAVAILABLE: 'The AI model is busy. Try again shortly.',
  MEDIA_FAILED: 'The video could not be processed.',
  RENDER_FAILED: 'The render failed.',
  INTERNAL: 'Something went wrong on the server.',
};

/** A toast-ready description of a failure. */
export interface ErrorText {
  /** `UPPER_SNAKE` code, or `UNEXPECTED` for an error without one. */
  code: string;
  /** One short sentence. */
  text: string;
}

/**
 * Describes any thrown value for a toast.
 * @param error - Usually an `ApiError` (has `code`), else anything.
 * @returns The code and a short human message; unknown codes fall back to the error's message.
 */
export function describeError(error: unknown): ErrorText {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNEXPECTED';
  const fallback = error instanceof Error && error.message !== '' ? error.message : 'Something went wrong.';
  return { code, text: TEXT[code] ?? fallback };
}
