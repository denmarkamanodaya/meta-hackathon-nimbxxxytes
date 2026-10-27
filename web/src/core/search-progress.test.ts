import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../services/api/types';
import { nextSearchView } from './search-progress';

const answer = (tookMs: number, reranked: boolean): SearchResponse => ({
  rewritten: {
    keywords: [],
    filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null },
  },
  results: [],
  reranked,
  took_ms: tookMs,
  cached: false,
  cost_usd: 0,
});

const local = answer(210, false);
const ranked = answer(3920, true);

describe('nextSearchView', () => {
  it('shows the local stage as refining', () => {
    expect(nextSearchView(null, { stage: 'local', response: local })).toEqual({
      response: local,
      localTookMs: null,
      isRefining: true,
    });
  });

  it('replaces local with ranked and keeps the local time for the meta line', () => {
    const view = nextSearchView(null, { stage: 'local', response: local });

    expect(nextSearchView(view, { stage: 'ranked', response: ranked })).toEqual({
      response: ranked,
      localTookMs: 210,
      isRefining: false,
    });
  });

  it('shows a ranked-only answer (fallback) with no local time', () => {
    expect(nextSearchView(null, { stage: 'ranked', response: ranked })).toEqual({
      response: ranked,
      localTookMs: null,
      isRefining: false,
    });
  });

  it('ignores a local stage that arrives after ranked', () => {
    const view = nextSearchView(null, { stage: 'ranked', response: ranked });

    expect(nextSearchView(view, { stage: 'local', response: local })).toBe(view);
  });

  it('keeps the local results and stops refining when the stream ends without ranked', () => {
    const view = nextSearchView(null, { stage: 'local', response: local });

    expect(nextSearchView(view, { stage: 'ended' })).toEqual({ response: local, localTookMs: null, isRefining: false });
    expect(nextSearchView(null, { stage: 'ended' })).toBeNull();
  });
});
