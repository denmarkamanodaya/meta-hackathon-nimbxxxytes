import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../services/api/types';
import { costLine, momentsLine, viewCostLine } from './search-meta';

describe('momentsLine', () => {
  it('counts moments and distinct clips, singular and plural', () => {
    expect(momentsLine([{ clip_id: 'a' }, { clip_id: 'a' }, { clip_id: 'b' }])).toBe('3 moments in 2 clips');
    expect(momentsLine([{ clip_id: 'a' }])).toBe('1 moment in 1 clip');
  });
});

describe('costLine', () => {
  it('says cached and $0 for a cached answer', () => {
    expect(costLine({ took_ms: 60, cached: true, cost_usd: 0 })).toEqual({ text: '0.06 s · cached, $0', isCached: true });
  });

  it('shows the model cost otherwise, with enough decimals for a fraction of a cent', () => {
    expect(costLine({ took_ms: 1840, cached: false, cost_usd: 0.0031 })).toEqual({ text: '1.84 s · $0.0031', isCached: false });
    expect(costLine({ took_ms: 2200, cached: false, cost_usd: 0.012 })).toEqual({ text: '2.20 s · $0.012', isCached: false });
  });
});

describe('viewCostLine', () => {
  const answer = (took_ms: number, cached: boolean, cost_usd: number): SearchResponse => ({
    rewritten: { keywords: [], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } },
    results: [],
    reranked: true,
    took_ms,
    cached,
    cost_usd,
  });

  it('shows only the local time while refining', () => {
    expect(viewCostLine({ response: answer(210, false, 0), localTookMs: null, isRefining: true })).toEqual({
      text: '0.21 s',
      isCached: false,
    });
  });

  it('adds the refined time and cost after the ranked stage', () => {
    expect(viewCostLine({ response: answer(3920, false, 0.0031), localTookMs: 210, isRefining: false })).toEqual({
      text: '0.21 s · refined 3.92 s · $0.0031',
      isCached: false,
    });
    expect(viewCostLine({ response: answer(50, true, 0), localTookMs: 190, isRefining: false })).toEqual({
      text: '0.19 s · refined 0.05 s · cached, $0',
      isCached: true,
    });
  });

  it('reads as the plain cost line without a local stage', () => {
    expect(viewCostLine({ response: answer(1840, false, 0.0031), localTookMs: null, isRefining: false })).toEqual({
      text: '1.84 s · $0.0031',
      isCached: false,
    });
  });
});
