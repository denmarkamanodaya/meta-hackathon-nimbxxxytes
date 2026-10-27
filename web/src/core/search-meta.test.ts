import { describe, expect, it } from 'vitest';
import { costLine, momentsLine } from './search-meta';

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
