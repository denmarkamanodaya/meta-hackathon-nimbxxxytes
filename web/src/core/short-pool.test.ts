import { describe, expect, it } from 'vitest';
import { parseResult } from '../services/api/parse-search';
import type { ClipDetail, Segment } from '../services/api/types';
import { bestFirst, hasMoments, poolLine, SHORT_POOL_MAX, shortPool } from './short-pool';

const clipOf = (clip_id: string): ClipDetail['clip'] => ({
  clip_id,
  title: `Clip ${clip_id}`,
  filename: `${clip_id}.mp4`,
  duration_s: 60,
  recorded_at: null,
  status: 'ready',
  thumb_url: null,
  segment_count: 0,
  people: [],
  duplicate_of: null,
  size_bytes: 0,
  project_ids: [],
  speech_count: 0,
  face_count: 0,
});

const seg = (segment_id: string, idx: number, hook_score: number | null, quality: number | null = null): Segment => ({
  segment_id,
  idx,
  start_s: idx * 5,
  end_s: idx * 5 + 5,
  description: `scene ${segment_id}`,
  actions: [],
  objects: [],
  place: null,
  mood: null,
  quality,
  hook_score,
  thumb_url: null,
});

/** A clip with `count` moments whose hook scores fall with clip order (`<id>0` is its best). */
const clipWith = (clip_id: string, count: number) => ({
  clip: clipOf(clip_id),
  segments: Array.from({ length: count }, (_, i) => seg(`${clip_id}${String(i)}`, i, 10 - i)),
});

describe('bestFirst', () => {
  it('ranks by hook score, then quality, then clip order, with missing scores last', () => {
    const ranked = bestFirst([
      seg('none', 0, null, null),
      seg('low', 1, 3, 9),
      seg('tie-worse', 2, 8, 4),
      seg('tie-better', 3, 8, 7),
      seg('no-hook', 4, null, 10),
      seg('tie-later', 5, 8, 7),
    ]);

    expect(ranked.map((s) => s.segment_id)).toEqual(['tie-better', 'tie-later', 'tie-worse', 'low', 'no-hook', 'none']);
  });
});

describe('shortPool', () => {
  it('takes each clip’s best moment first, round-robin in selection order', () => {
    const a = { clip: clipOf('a'), segments: [seg('a-weak', 0, 2), seg('a-best', 1, 9), seg('a-mid', 2, 5)] };
    const b = { clip: clipOf('b'), segments: [seg('b-mid', 0, 6), seg('b-best', 1, 8)] };

    const pool = shortPool([a, b]);

    expect(pool.segmentIds).toEqual(['a-best', 'b-best', 'a-mid', 'b-mid', 'a-weak']);
    expect(pool.moments.map((m) => m.clip_id)).toEqual(['a', 'b', 'a', 'b', 'a']);
    expect(pool.moments.map((m) => m.segment_id)).toEqual(pool.segmentIds);
  });

  it('stops at the API limit of 20 moments', () => {
    const pool = shortPool([clipWith('a', 15), clipWith('b', 15)]);

    expect(SHORT_POOL_MAX).toBe(20);
    expect(pool.segmentIds).toHaveLength(20);
    expect(new Set(pool.segmentIds).size).toBe(20);
    expect(pool.segmentIds.slice(0, 4)).toEqual(['a0', 'b0', 'a1', 'b1']);
  });

  it('keeps one moment from every clip that has any, even when one clip alone could fill the pool', () => {
    const pool = shortPool([clipWith('big', 40), clipWith('one', 1), clipWith('two', 2)]);

    expect(pool.segmentIds).toHaveLength(20);
    expect(pool.segmentIds.slice(0, 3)).toEqual(['big0', 'one0', 'two0']);
    expect(new Set(pool.moments.map((m) => m.clip_id))).toEqual(new Set(['big', 'one', 'two']));
  });

  it('skips a clip with no moments and sends nothing when no clip has any', () => {
    const empty = { clip: clipOf('empty'), segments: [] };

    expect(shortPool([empty, clipWith('a', 2)]).segmentIds).toEqual(['a0', 'a1']);
    expect(shortPool([empty])).toEqual({ segmentIds: [], moments: [] });
    expect(shortPool([])).toEqual({ segmentIds: [], moments: [] });
  });

  it('serves one clip the same way: its moments best first, at most 20', () => {
    const one = { clip: clipOf('c'), segments: [seg('c0', 0, 1), seg('c1', 1, 7)] };

    expect(shortPool([one]).segmentIds).toEqual(['c1', 'c0']);
    expect(shortPool([clipWith('long', 30)]).segmentIds).toHaveLength(20);
  });

  it('hands rows the editor’s wire parser accepts unchanged', () => {
    const pool = shortPool([clipWith('a', 2)]);

    expect(pool.moments[0]).toMatchObject({ segment_id: 'a0', clip_id: 'a', clip_title: 'Clip a', reason: 'scene a0', score: 0 });
    expect(pool.moments.map(parseResult)).toEqual(pool.moments);
  });
});

describe('poolLine', () => {
  it('says how many moments from how many clips, singular for one', () => {
    expect(poolLine([{ clip_id: 'a' }, { clip_id: 'b' }, { clip_id: 'a' }])).toBe('3 moments from 2 clips');
    expect(poolLine([{ clip_id: 'a' }])).toBe('1 moment from 1 clip');
  });
});

describe('hasMoments', () => {
  it('is true once a selected clip is ready and has a moment', () => {
    expect(hasMoments([{ status: 'uploaded', segment_count: 4 }, { status: 'ready', segment_count: 0 }])).toBe(false);
    expect(hasMoments([{ status: 'ready', segment_count: 0 }, { status: 'ready', segment_count: 2 }])).toBe(true);
    expect(hasMoments([])).toBe(false);
  });
});
