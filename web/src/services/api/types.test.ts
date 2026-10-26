import { describe, expect, it } from 'vitest';
import errorCodes from './error-codes.json';
import { ERROR, isErrorCode } from './types';

describe('error codes', () => {
  it('lists unique UPPER_SNAKE codes', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
    for (const code of errorCodes) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });

  it('recognises listed codes only', () => {
    expect(isErrorCode('FORBIDDEN')).toBe(true);
    expect(isErrorCode('forbidden')).toBe(false);
    expect(isErrorCode(42)).toBe(false);
  });

  it('every code the web branches on is in the list', () => {
    for (const code of Object.values(ERROR)) expect(errorCodes).toContain(code);
  });
});
