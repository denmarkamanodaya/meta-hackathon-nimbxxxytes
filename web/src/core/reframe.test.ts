import { describe, expect, it } from 'vitest';
import type { ReframeResponse, TimelineClip } from '../services/api/types';
import { REFRAME_COPY } from './copy';
import { hasCropPath, reframeSummary, shotRow, shotStatus, shouldStartReframe, withoutCropPath } from './reframe';

const clip = (segment: string, subject: string | null, len = 6): TimelineClip => ({
  segment_id: segment,
  in: 10,
  out: 10 + len,
  subject,
  punch_in: 1,
  reason: '',
});

const clips = [clip('s1', 'person walking'), clip('s2', 'purple car', 5), clip('s3', 'dog', 7), clip('s4', 'ferry')];
const ready: ReframeResponse = {
  status: 'ready',
  shots: [
    { segment_id: 's1', subject: 'person walking', frames_tracked: 72, frames_total: 72, lost_s: 0 },
    { segment_id: 's2', subject: 'purple car', frames_tracked: 60, frames_total: 60, lost_s: 0 },
    { segment_id: 's3', subject: 'dog', frames_tracked: 60, frames_total: 84, lost_s: 2 },
    { segment_id: 's4', subject: 'ferry', frames_tracked: 72, frames_total: 72, lost_s: 0 },
  ],
};

describe('shotStatus', () => {
  it('says how long it followed, or that it lost the subject and held still', () => {
    expect(shotStatus(clips[0] ?? clip('x', null), 'ready', ready.shots[0])).toEqual({ text: 'Followed all 6 s', isLost: false });
    expect(shotStatus(clips[2] ?? clip('x', null), 'ready', ready.shots[2])).toEqual({ text: 'Lost it for 2 s · held still', isLost: true });
  });

  it('covers no subject, a run in flight and a shot not tracked yet', () => {
    expect(shotStatus(clip('s', null), 'ready', undefined).text).toBe(REFRAME_COPY.noSubject);
    expect(shotStatus(clip('s', 'dog'), 'running', undefined).text).toBe(REFRAME_COPY.tracking);
    expect(shotStatus(clip('s', 'dog'), 'ready', undefined).text).toBe(REFRAME_COPY.waiting);
  });
});

describe('shotRow', () => {
  it('matches by segment and subject, so a changed subject has no row', () => {
    expect(shotRow(ready, { segment_id: 's3', subject: 'dog' })?.lost_s).toBe(2);
    expect(shotRow(ready, { segment_id: 's3', subject: 'cat' })).toBeUndefined();
    expect(shotRow(null, { segment_id: 's3', subject: 'dog' })).toBeUndefined();
  });
});

describe('reframeSummary', () => {
  it('counts the followed shots and the one that was lost', () => {
    expect(reframeSummary(true, ready, clips)).toBe('4 of 4 shots followed · 1 lost the subject for 2 s and held still');
  });

  it('counts shots with a subject only, and several lost shots', () => {
    const twoLost = { ...ready, shots: ready.shots.map((s) => ({ ...s, lost_s: s.segment_id === 's4' ? 0 : 1 })) };

    expect(reframeSummary(true, twoLost, [...clips, clip('s5', null)])).toBe('4 of 4 shots followed · 3 lost the subject and held still');
  });

  it('says off, waiting, tracking or failed', () => {
    expect(reframeSummary(false, ready, clips)).toBe(REFRAME_COPY.off);
    expect(reframeSummary(true, null, clips)).toBe(REFRAME_COPY.waiting);
    expect(reframeSummary(true, { status: 'running', shots: [] }, clips)).toBe(REFRAME_COPY.tracking);
    expect(reframeSummary(true, { status: 'failed', shots: [] }, clips)).toBe(REFRAME_COPY.failed);
  });
});

describe('shouldStartReframe', () => {
  it('starts only with the switch on and nothing run yet', () => {
    expect(shouldStartReframe(true, 'idle')).toBe(true);
    expect(shouldStartReframe(false, 'idle')).toBe(false);
    expect(shouldStartReframe(true, 'running')).toBe(false);
    expect(shouldStartReframe(true, 'ready')).toBe(false);
  });
});

describe('the centre crop preview', () => {
  const props = {
    fps: 30,
    clips: [
      { segment_id: 's1', crop_path: [{ t_s: 0, cx: 0.4, cy: 0.5 }] },
      { segment_id: 's2' },
    ],
  };

  it('drops every crop path and keeps the rest', () => {
    const centre = withoutCropPath(props);

    expect(centre.clips).toEqual([{ segment_id: 's1' }, { segment_id: 's2' }]);
    expect(centre.fps).toBe(30);
    expect(props.clips[0]).toHaveProperty('crop_path');
    expect(hasCropPath(centre)).toBe(false);
  });

  it('sees a crop path only when one has keyframes', () => {
    expect(hasCropPath(props)).toBe(true);
    expect(hasCropPath({ clips: [{ crop_path: [] }] })).toBe(false);
  });
});
