import { describe, expect, it } from 'vitest';
import type { FindHit, FindResponse } from '../services/api/types';
import { chipText, foundSummary, handoffFromHits, hitClipPath, hitLine, inViewBand, showAllPath } from './find-this';

const hit = (clip: string, segment: string, recorded: string | null = '2026-10-22T09:00:00Z'): FindHit => ({
  clip_id: clip,
  clip_title: `${clip} title`,
  recorded_at: recorded,
  segment_id: segment,
  start_s: 4,
  end_s: 9.5,
  thumb_url: null,
  score: 0.8,
});

const found: FindResponse = {
  label: 'mug',
  in_view: { start_s: 41, end_s: 58 },
  outline: null,
  hits: [hit('here', 's1'), hit('a', 's2'), hit('a', 's3'), hit('b', 's4')],
};

describe('inViewBand', () => {
  it('places the band as a share of the clip', () => {
    expect(inViewBand({ start_s: 41, end_s: 58 }, 134)).toEqual({ left: (41 / 134) * 100, width: (17 / 134) * 100 });
  });

  it('clamps a range past the end and waits for a known length', () => {
    expect(inViewBand({ start_s: 120, end_s: 200 }, 134)?.width).toBeCloseTo((14 / 134) * 100);
    expect(inViewBand({ start_s: 1, end_s: 2 }, Number.NaN)).toBeNull();
    expect(inViewBand({ start_s: 1, end_s: 2 }, 0)).toBeNull();
  });
});

describe('the words', () => {
  it('names the object and where it is in view', () => {
    expect(chipText(found)).toBe('mug · in view 0:41–0:58');
  });

  it('counts other clips once each', () => {
    expect(foundSummary(found, 'here')).toBe('In view 0:41–0:58 here · seen in 2 other clips');
    expect(foundSummary({ ...found, hits: [hit('here', 's1'), hit('a', 's2')] }, 'here')).toContain('seen in 1 other clip');
    expect(foundSummary({ ...found, hits: [hit('here', 's1')] }, 'here')).toContain('not seen in other clips');
  });

  it('says This clip for the tapped clip and the date for the others', () => {
    const now = new Date('2026-10-28T00:00:00Z');

    expect(hitLine(hit('here', 's1'), 'here', now)).toBe('This clip · 0:04–0:09');
    expect(hitLine(hit('a', 's2'), 'here', now)).toBe('22 Oct · 0:04–0:09');
    expect(hitLine(hit('a', 's2', null), 'here', now)).toBe('0:04–0:09');
  });
});

describe('the paths', () => {
  it('searches the Gallery for the name and opens another clip at the moment', () => {
    expect(showAllPath('red mug')).toBe('/search?q=red%20mug');
    expect(hitClipPath({ clip_id: 'c 1', start_s: 4.5 })).toBe('/clips/c%201?t=4.5');
  });
});

describe('handoffFromHits', () => {
  it('hands every segment over once, in the order found', () => {
    const handoff = handoffFromHits([...found.hits, hit('b', 's4')]);

    expect(handoff.segmentIds).toEqual(['s1', 's2', 's3', 's4']);
    expect(handoff.moments[1]).toMatchObject({ segment_id: 's2', clip_id: 'a', clip_title: 'a title', start_s: 4, end_s: 9.5 });
  });
});
