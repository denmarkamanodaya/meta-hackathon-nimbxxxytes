import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '../services/api/types';
import { momentsLine, plainSeconds, scopeToClips, searchBadges } from './search-meta';

describe('momentsLine', () => {
  it('counts moments and distinct clips, singular and plural', () => {
    expect(momentsLine([{ clip_id: 'a' }, { clip_id: 'a' }, { clip_id: 'b' }])).toBe('3 moments in 2 clips');
    expect(momentsLine([{ clip_id: 'a' }])).toBe('1 moment in 1 clip');
  });
});

describe('scopeToClips', () => {
  const response = { took_ms: 5, results: [{ clip_id: 'a', n: 1 }, { clip_id: 'b', n: 2 }, { clip_id: 'a', n: 3 }] };

  it('keeps only the given clips, in order, and leaves the rest of the answer alone', () => {
    expect(scopeToClips(response, ['a'])).toEqual({ took_ms: 5, results: [{ clip_id: 'a', n: 1 }, { clip_id: 'a', n: 3 }] });
    expect(scopeToClips(response, [])).toEqual({ took_ms: 5, results: [] });
  });

  it('keeps everything without a scope', () => {
    expect(scopeToClips(response, null)).toBe(response);
  });
});

describe('plainSeconds', () => {
  it('writes one decimal, and "under 0.1 s" for less', () => {
    expect(plainSeconds(2480)).toBe('2.5 s');
    expect(plainSeconds(210)).toBe('0.2 s');
    expect(plainSeconds(60)).toBe('under 0.1 s');
  });
});

describe('searchBadges', () => {
  const answer = (took_ms: number, cached: boolean, reranked: boolean): SearchResponse => ({
    rewritten: { keywords: [], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } },
    results: [],
    reranked,
    took_ms,
    cached,
    cost_usd: cached ? 0 : 0.0031,
  });

  it('says Muse Spark refined the order, and how long it took', () => {
    expect(searchBadges({ response: answer(2480, false, true), localTookMs: 210, isRefining: false })).toEqual([
      { text: 'Refined by Muse Spark · 2.5 s', tone: 'accent' },
    ]);
  });

  it('adds "Asked before · free" for a cached answer, without the cache time', () => {
    expect(searchBadges({ response: answer(50, true, true), localTookMs: null, isRefining: false })).toEqual([
      { text: 'Refined by Muse Spark', tone: 'accent' },
      { text: 'Asked before · free', tone: 'success' },
    ]);
  });

  it('calls held local results an instant answer, with the local time', () => {
    expect(searchBadges({ response: answer(210, false, false), localTookMs: null, isRefining: false })).toEqual([
      { text: 'Instant answer · 0.2 s', tone: 'neutral' },
    ]);
  });

  it('shows no money and no engine telemetry', () => {
    const texts = [answer(2480, false, true), answer(50, true, true), answer(210, false, false)].flatMap((response) =>
      searchBadges({ response, localTookMs: 190, isRefining: false }).map((badge) => badge.text),
    );

    expect(texts.join(' ')).not.toMatch(/[$]|cached|refined [0-9]/);
  });
});
