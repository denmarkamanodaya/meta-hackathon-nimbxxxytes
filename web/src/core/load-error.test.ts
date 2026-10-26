import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/api/client';
import { ERROR } from '../services/api/types';
import { loadErrorView } from './load-error';

describe('loadErrorView', () => {
  it('says the server is unreachable and offers Retry for network, timeout and bad gateway', () => {
    for (const error of [
      new ApiError('NETWORK_ERROR', 'down', null),
      new ApiError('TIMEOUT', 'slow', null),
      new ApiError('BAD_RESPONSE', 'HTTP 502 without an error body', 502),
    ]) {
      expect(loadErrorView(error, 'short')).toMatchObject({ title: 'Can’t reach nimbytes right now', canRetry: true });
    }
  });

  it('says a missing item is gone, without Retry', () => {
    expect(loadErrorView(new ApiError(ERROR.NOT_FOUND, 'no', 404), 'clip')).toMatchObject({
      title: 'This clip no longer exists',
      canRetry: false,
      code: 'NOT_FOUND',
    });
  });

  it('says another user’s item is not yours, without Retry', () => {
    expect(loadErrorView(new ApiError(ERROR.FORBIDDEN, 'x', 403), 'short').canRetry).toBe(false);
  });

  it('says the server hit an error (not unreachable) for INTERNAL, and still retries', () => {
    expect(loadErrorView(new ApiError(ERROR.INTERNAL, 'internal error', 500), 'short')).toMatchObject({
      title: 'Could not load this short',
      canRetry: true,
      code: 'INTERNAL',
    });
  });
});
