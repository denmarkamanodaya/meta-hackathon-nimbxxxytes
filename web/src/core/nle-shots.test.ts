import { describe, expect, it } from 'vitest';
import type { ShortSegment, TimelineClip } from '../services/api/types';
import { nleShots } from './nle-shots';

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

  it('keeps a shot whose segment is unknown, without clip or thumb', () => {
    expect(nleShots([clip('sx', 0, 1, 'r')], [], new Map())[0]).toMatchObject({ clipId: null, thumbUrl: null, name: 'Shot 1' });
  });
});
