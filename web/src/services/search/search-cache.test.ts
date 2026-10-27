import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../api/types';
import { createSearchCache } from './search-cache';

const answer = (keyword: string): SearchResponse => ({
  rewritten: {
    keywords: [keyword],
    filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null },
  },
  results: [],
  reranked: true, took_ms: 60, cached: false, cost_usd: 0,
});

describe('createSearchCache', () => {
  it('returns a stored answer for the same query only', () => {
    const cache = createSearchCache(3);
    cache.set('beach', answer('beach'));

    expect(cache.get('beach')).toEqual(answer('beach'));
    expect(cache.get('Beach')).toBeUndefined();
  });

  it('drops the least recently used answer past the cap', () => {
    const cache = createSearchCache(2);
    cache.set('a', answer('a'));
    cache.set('b', answer('b'));
    cache.get('a');

    cache.set('c', answer('c'));

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });
});
