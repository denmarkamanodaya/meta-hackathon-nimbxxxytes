import { describe, expect, it } from 'vitest';
import type { UnnamedFace } from '../services/api/types';
import { faceCardLine, faceCards, matchLine, type FaceCard } from './face-groups';

const face = (track_id: string, clip_id: string, group_id: string | null, similarity: number | null = null): UnnamedFace => ({
  track_id,
  clip_id,
  clip_title: clip_id,
  recorded_at: null,
  on_screen_s: 3,
  crop_url: null,
  group_id,
  suggested: similarity === null ? null : { person_id: 'p_leo', name: 'Leo', similarity },
});

describe('faceCards', () => {
  it('puts a group on one card, ungrouped faces on their own, in first-seen order', () => {
    const cards = faceCards(
      [face('t1', 'c1', 'g_dog'), face('t2', 'c2', null), face('t3', 'c3', 'g_dog'), face('t4', 'c3', 'g_dog')],
      new Set(),
    );

    expect(cards.map((c) => [c.key, c.faces.map((f) => f.track_id), c.clipCount])).toEqual([
      ['g_dog', ['t1', 't3', 't4'], 2],
      ['t2', ['t2'], 1],
    ]);
  });

  it('offers the most similar suggestion of a group, and none once dismissed', () => {
    const faces = [face('t1', 'c1', 'g_leo', 0.86), face('t2', 'c2', 'g_leo', 0.93), face('t3', 'c3', 'g_leo')];

    expect(faceCards(faces, new Set())[0]?.suggested?.similarity).toBe(0.93);
    expect(faceCards(faces, new Set(['g_leo']))[0]?.suggested).toBeNull();
    expect(faceCards([face('t9', 'c9', null)], new Set())[0]?.suggested).toBeNull();
  });
});

describe('faceCardLine and matchLine', () => {
  const face = (track_id: string, clip_id: string, on_screen_s: number): FaceCard['faces'][number] => ({
    track_id,
    clip_id,
    clip_title: 'Coffee pour',
    recorded_at: null,
    on_screen_s,
    crop_url: null,
    group_id: null,
    suggested: null,
  });

  it('names the clip and the time on screen for one clip', () => {
    expect(faceCardLine({ key: 't1', faces: [face('t1', 'c1', 9.4)], clipCount: 1, suggested: null })).toBe('Coffee pour · 0:09');
  });

  it('counts clips for a group that spans several', () => {
    const card = { key: 'g', faces: [face('t1', 'c1', 4), face('t2', 'c2', 3), face('t3', 'c3', 2)], clipCount: 3, suggested: null };

    expect(faceCardLine(card)).toBe('in 3 clips');
    expect(matchLine(card)).toBe('Muse Spark: same person, 3 clips');
    expect(matchLine({ ...card, clipCount: 1 })).toBe('Muse Spark: same person, 1 clip');
  });
});
