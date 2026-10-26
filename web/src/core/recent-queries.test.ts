import { describe, expect, it } from 'vitest';
import { addRecentQuery } from './recent-queries';

describe('addRecentQuery', () => {
  it('puts the newest query first and tidies its spacing', () => {
    expect(addRecentQuery(['beach'], '  latte   art ')).toEqual(['latte art', 'beach']);
  });

  it('moves a repeat to the front instead of duplicating it, ignoring case', () => {
    expect(addRecentQuery(['beach', 'Sam laughing'], 'sam laughing')).toEqual(['sam laughing', 'beach']);
  });

  it('caps the list', () => {
    expect(addRecentQuery(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });

  it('ignores a blank query', () => {
    expect(addRecentQuery(['a'], '   ')).toEqual(['a']);
  });
});
