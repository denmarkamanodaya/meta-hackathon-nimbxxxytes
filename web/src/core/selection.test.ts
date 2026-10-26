import { describe, expect, it } from 'vitest';
import { readEditorHandoff, readStartParam, toggleSelection } from './selection';

describe('toggleSelection', () => {
  it('appends in pick order and removes on a second tap', () => {
    let picked = toggleSelection([], 's3');
    picked = toggleSelection(picked, 's1');
    expect(picked).toEqual(['s3', 's1']);

    expect(toggleSelection(picked, 's3')).toEqual(['s1']);
  });
});

describe('readEditorHandoff', () => {
  it('reads the segment ids passed from Search', () => {
    expect(readEditorHandoff({ segmentIds: ['s1', 's2'] })).toEqual(['s1', 's2']);
  });

  it('reads nothing from missing or foreign state', () => {
    expect(readEditorHandoff(null)).toEqual([]);
    expect(readEditorHandoff({ segmentIds: [1, 2] })).toEqual([]);
    expect(readEditorHandoff('s1')).toEqual([]);
  });
});

describe('readStartParam', () => {
  it('reads fractional seconds', () => {
    expect(readStartParam('12.6')).toBe(12.6);
    expect(readStartParam('0')).toBe(0);
  });

  it('ignores a missing, negative or non-numeric value', () => {
    expect(readStartParam(null)).toBeNull();
    expect(readStartParam('')).toBeNull();
    expect(readStartParam('-3')).toBeNull();
    expect(readStartParam('soon')).toBeNull();
  });
});
