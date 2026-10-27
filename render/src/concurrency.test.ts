import { describe, expect, it } from 'vitest';
import { renderConcurrency } from './concurrency.ts';

describe('renderConcurrency', () => {
  it('keeps the configured value when the machine has enough cores', () => {
    expect(renderConcurrency(3, 4)).toBe(3);
    expect(renderConcurrency(2, 2)).toBe(2);
  });

  it('caps the value at the core count, which Remotion requires', () => {
    expect(renderConcurrency(3, 2)).toBe(2);
  });

  it('never goes below 1', () => {
    expect(renderConcurrency(3, 0)).toBe(1);
  });
});
