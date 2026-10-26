import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../services/api/types';
import { diffClips, dropClip, moveClip, timelineLength, trimClip } from './timeline-edit';

const clip = (segment_id: string, start: number, end: number): TimelineClip => ({
  segment_id,
  in: start,
  out: end,
  subject: null,
  punch_in: 1,
  reason: `why ${segment_id}`,
});
const ids = (clips: TimelineClip[]) => clips.map((c) => c.segment_id);

describe('moveClip', () => {
  const clips = [clip('a', 0, 2), clip('b', 0, 2), clip('c', 0, 2)];

  it('moves a clip down and up', () => {
    expect(ids(moveClip(clips, 0, 2))).toEqual(['b', 'c', 'a']);
    expect(ids(moveClip(clips, 2, 0))).toEqual(['c', 'a', 'b']);
  });

  it('clamps the target and ignores a bad source index', () => {
    expect(ids(moveClip(clips, 0, 99))).toEqual(['b', 'c', 'a']);
    expect(ids(moveClip(clips, 7, 0))).toEqual(['a', 'b', 'c']);
  });
});

describe('dropClip', () => {
  it('removes only the clip at the index', () => {
    expect(ids(dropClip([clip('a', 0, 1), clip('b', 0, 1)], 0))).toEqual(['b']);
  });
});

describe('trimClip', () => {
  const segment = { start_s: 10, end_s: 20 };
  const c = clip('a', 12, 16);

  it('moves in and out within the segment', () => {
    expect(trimClip(c, 'in', 11, segment).in).toBe(11);
    expect(trimClip(c, 'out', 18.04, segment).out).toBe(18);
  });

  it('never leaves the segment bounds', () => {
    expect(trimClip(c, 'in', 3, segment).in).toBe(10);
    expect(trimClip(c, 'out', 25, segment).out).toBe(20);
  });

  it('keeps at least 0.6 s between in and out', () => {
    expect(trimClip(c, 'in', 15.9, segment).in).toBe(15.4);
    expect(trimClip(c, 'out', 12.1, segment).out).toBe(12.6);
  });
});

describe('timelineLength', () => {
  it('sums clip lengths', () => {
    expect(timelineLength([clip('a', 1, 3.5), clip('b', 10, 12)])).toBe(4.5);
  });
});

describe('diffClips', () => {
  it('reports added, removed, retimed and moved clips', () => {
    const v1 = [clip('a', 0, 2), clip('b', 0, 2), clip('c', 0, 2), clip('d', 0, 2)];
    const v2 = [clip('b', 0, 2), clip('a', 0, 2), clip('c', 0, 1.5), clip('e', 0, 2)];

    expect(diffClips(v1, v2)).toEqual([
      { segment_id: 'b', change: 'moved' },
      { segment_id: 'a', change: 'moved' },
      { segment_id: 'c', change: 'retimed' },
      { segment_id: 'e', change: 'added' },
      { segment_id: 'd', change: 'removed' },
    ]);
  });

  it('reports nothing for identical versions', () => {
    const v = [clip('a', 0, 2), clip('b', 3, 4)];

    expect(diffClips(v, v)).toEqual([]);
  });

  it('does not call a clip moved when only an earlier clip was removed', () => {
    expect(diffClips([clip('a', 0, 1), clip('b', 0, 1)], [clip('b', 0, 1)])).toEqual([
      { segment_id: 'a', change: 'removed' },
    ]);
  });
});
