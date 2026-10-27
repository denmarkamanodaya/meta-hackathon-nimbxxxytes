import { describe, expect, it } from 'vitest';
import { hiddenFacesLine } from './hidden-faces';

describe('hiddenFacesLine', () => {
  it('counts hidden faces in the cut and the shots they appear in', () => {
    expect(hiddenFacesLine(['c1', 'c1', 'c2', 'c9'], ['c1', 'c2', 'c1', 'c3', 'c4'])).toBe(
      '3 hidden faces across 3 shots',
    );
  });

  it('uses the singular for one of each', () => {
    expect(hiddenFacesLine(['c1'], ['c1', 'c2'])).toBe('1 hidden face across 1 shot');
  });

  it('says so when no hidden face is in the cut', () => {
    expect(hiddenFacesLine(['c9'], ['c1'])).toBe('No hidden faces in this short');
  });
});
