import { describe, expect, it } from 'vitest';
import { parseResult } from '../services/api/parse-search';
import { handoffFromClip, readEditorHandoff, readStartParam, toggleSelection } from './selection';

describe('toggleSelection', () => {
  it('appends in pick order and removes on a second tap', () => {
    let picked = toggleSelection([], 's3');
    picked = toggleSelection(picked, 's1');
    expect(picked).toEqual(['s3', 's1']);

    expect(toggleSelection(picked, 's3')).toEqual(['s1']);
  });
});

describe('readEditorHandoff', () => {
  it('reads the segment ids passed from Search', () => {
    expect(readEditorHandoff({ segmentIds: ['s1', 's2'] })).toEqual(['s1', 's2']);
  });

  it('reads nothing from missing or foreign state', () => {
    expect(readEditorHandoff(null)).toEqual([]);
    expect(readEditorHandoff({ segmentIds: [1, 2] })).toEqual([]);
    expect(readEditorHandoff('s1')).toEqual([]);
  });
});

describe('readStartParam', () => {
  it('reads fractional seconds', () => {
    expect(readStartParam('12.6')).toBe(12.6);
    expect(readStartParam('0')).toBe(0);
  });

  it('ignores a missing, negative or non-numeric value', () => {
    expect(readStartParam(null)).toBeNull();
    expect(readStartParam('')).toBeNull();
    expect(readStartParam('-3')).toBeNull();
    expect(readStartParam('soon')).toBeNull();
  });
});

describe('handoffFromClip', () => {
  it('hands every moment of the clip to the editor, in clip order, as result rows', () => {
    const clip = { clip_id: 'c1', title: 'Coffee', filename: 'c.mp4', duration_s: 20, recorded_at: null, status: 'ready' as const, thumb_url: null, segment_count: 2, people: [], duplicate_of: null };
    const segment = (segment_id: string, start_s: number) => ({
      segment_id,
      idx: 0,
      start_s,
      end_s: start_s + 5,
      description: `scene ${segment_id}`,
      actions: [],
      objects: [],
      place: null,
      mood: null,
      quality: null,
      hook_score: null,
      thumb_url: null,
    });

    const handoff = handoffFromClip({ clip, segments: [segment('s1', 0), segment('s2', 5)] });

    expect(handoff.segmentIds).toEqual(['s1', 's2']);
    expect(handoff.moments[1]).toMatchObject({ segment_id: 's2', clip_id: 'c1', clip_title: 'Coffee', reason: 'scene s2', faces: [] });
    // The editor re-reads router state with the wire parser; rows it rejects are dropped.
    expect(handoff.moments.map(parseResult)).toEqual(handoff.moments);
  });
});
