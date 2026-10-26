import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/api/client';
import { describeError } from './error-text';

describe('describeError', () => {
  it('pairs a known code with its short message', () => {
    expect(describeError(new ApiError('NETWORK_ERROR', 'Could not reach the server', null))).toEqual({
      code: 'NETWORK_ERROR',
      text: 'You seem to be offline.',
    });
  });

  it('keeps an unknown code and uses the error message', () => {
    expect(describeError({ code: 'BRAND_NEW', message: 'x' })).toEqual({ code: 'BRAND_NEW', text: 'Something went wrong.' });
    expect(describeError(Object.assign(new Error('disk full'), { code: 'NOPE' }))).toEqual({ code: 'NOPE', text: 'disk full' });
  });

  it('labels a value without a code as UNEXPECTED', () => {
    expect(describeError(new Error('boom'))).toEqual({ code: 'UNEXPECTED', text: 'boom' });
    expect(describeError('weird')).toEqual({ code: 'UNEXPECTED', text: 'Something went wrong.' });
  });
});
