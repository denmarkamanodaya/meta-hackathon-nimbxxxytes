// What a screen says when its data could not be loaded: unreachable (keep trying), gone, or
// not allowed. The code comes from the typed error; the screen keeps polling in the background.
import { describeError } from './error-text';

/** How a load failure is shown. */
export interface LoadErrorView {
  title: string;
  body: string;
  /** Offer Retry (the screen also retries by itself). */
  canRetry: boolean;
  code: string;
}

/** Codes that mean the server could not be reached (502 pages from the proxy are BAD_RESPONSE). */
const UNREACHABLE = new Set(['NETWORK_ERROR', 'TIMEOUT', 'BAD_RESPONSE']);

/**
 * Describes a failed load.
 * @param error - The thrown value (usually an `ApiError`).
 * @param thing - What was being loaded, for example "short" or "clip".
 * @returns Title, body, whether to offer Retry, and the code.
 */
export function loadErrorView(error: unknown, thing: string): LoadErrorView {
  const { code, text } = describeError(error);
  if (code === 'NOT_FOUND') {
    return { title: `This ${thing} no longer exists`, body: 'It may have been removed.', canRetry: false, code };
  }
  if (code === 'FORBIDDEN') {
    return { title: `This ${thing} is not yours`, body: text, canRetry: false, code };
  }
  if (UNREACHABLE.has(code)) {
    return {
      title: 'Can’t reach nimbytes right now',
      body: 'We’ll keep trying in the background, so this page fills in when the server is back.',
      canRetry: true,
      code,
    };
  }
  if (code === 'INTERNAL') {
    return {
      title: `Could not load this ${thing}`,
      body: 'The server hit an error. We’ll keep trying in the background.',
      canRetry: true,
      code,
    };
  }
  return { title: `Could not load this ${thing}`, body: text, canRetry: true, code };
}
