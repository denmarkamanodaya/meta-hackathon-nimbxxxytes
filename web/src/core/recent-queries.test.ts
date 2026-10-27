import { describe, expect, it } from 'vitest';
import { addRecentQuery, suggestedQueries } from './recent-queries';

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

describe('suggestedQueries', () => {
  it('shows the latest recent queries, else the starters, at most 3', () => {
    expect(suggestedQueries(['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(suggestedQueries([])).toEqual(['coffee this morning', 'Sam laughing', 'the purple coupe']);
  });
});
