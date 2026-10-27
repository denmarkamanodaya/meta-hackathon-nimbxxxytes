import { describe, expect, it } from 'vitest';
import type { ShortSegment, TimelineClip } from '../services/api/types';
import { cutPercents, nleShots, shotAt } from './nle-shots';

describe('cutPercents', () => {
  it('marks every cut after the first shot, as a share of the whole short', () => {
    expect(cutPercents([0, 2.5, 5], 10)).toEqual([25, 50]);
  });

  it('leaves out cuts outside the short, and an empty short has none', () => {
    expect(cutPercents([0, 4, 12], 10)).toEqual([40]);
    expect(cutPercents([0, 4], 0)).toEqual([]);
  });
});

describe('shotAt', () => {
  it('finds the shot under the playhead, -1 before the first', () => {
    expect(shotAt([0, 3.3, 6.6], 3.3)).toBe(1);
    expect(shotAt([0, 3.3, 6.6], 9)).toBe(2);
    expect(shotAt([1, 2], 0.5)).toBe(-1);
  });
});

const clip = (segment_id: string, start: number, end: number, reason: string): TimelineClip => ({
  segment_id,
  in: start,
  out: end,
  subject: null,
  punch_in: 1,
  reason,
});
const segment = (segment_id: string, clip_id: string): ShortSegment => ({
  segment_id,
  clip_id,
  start_s: 0,
  end_s: 10,
  thumb_url: `https://t/${segment_id}.jpg`,
  description: null,
});

describe('nleShots', () => {
  it('starts each shot where the previous one ends on the output timeline', () => {
    const rows = nleShots(
      [clip('s1', 2, 5.5, 'Strongest hook'), clip('s2', 10, 13.5, 'Reaction'), clip('s1', 0, 4.2, 'Again')],
      [segment('s1', 'c1'), segment('s2', 'c2')],
      new Map([['s1', 'Latte pour']]),
    );

    expect(rows.map((row) => [row.at, row.name, row.clipId, row.reason])).toEqual([
      ['0:00.0', 'Latte pour', 'c1', 'Strongest hook'],
      ['0:03.5', 'Shot 2', 'c2', 'Reaction'],
      ['0:07.0', 'Latte pour', 'c1', 'Again'],
    ]);
    expect(rows[0]?.thumbUrl).toBe('https://t/s1.jpg');
    expect(new Set(rows.map((row) => row.key)).size).toBe(3);
  });

  it('gives each start in seconds too, for seeking', () => {
    const rows = nleShots([clip('s1', 2, 5.5, 'a'), clip('s2', 10, 13.5, 'b')], [], new Map());

    expect(rows.map((row) => row.startS)).toEqual([0, 3.5]);
  });

  it('keeps a shot whose segment is unknown, without clip or thumb', () => {
    expect(nleShots([clip('sx', 0, 1, 'r')], [], new Map())[0]).toMatchObject({ clipId: null, thumbUrl: null, name: 'Shot 1' });
  });
});
