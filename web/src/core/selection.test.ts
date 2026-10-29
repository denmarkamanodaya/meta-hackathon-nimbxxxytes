import { describe, expect, it } from 'vitest';
import { parseResult } from '../services/api/parse-search';
import { clipsSelectedLine, handoffFromClip, handoffFromRange, selectModeClick, menuTargets, pickedAmong, pickedSummary, tileClick, readEditorHandoff, readStartParam, toggleSelection } from './selection';

describe('pickedSummary', () => {
  const rows = [
    { segment_id: 'a', start_s: 7, end_s: 15 },
    { segment_id: 'b', start_s: 0, end_s: 7 },
    { segment_id: 'c', start_s: 45, end_s: 52.6 },
  ];

  it('counts the picked moments and adds up how long they run', () => {
    expect(pickedSummary(['a', 'b'], rows)).toBe('2 moments · 0:15');
    expect(pickedSummary(['c'], rows)).toBe('1 moment · 0:07');
  });

  it('reads "0 moments · 0:00" before anything is picked, and skips picks no longer on screen', () => {
    expect(pickedSummary([], rows)).toBe('0 moments · 0:00');
    expect(pickedSummary(['gone', 'a'], rows)).toBe('1 moment · 0:08');
  });

  it('adds the fractions before rounding down, and never counts a backwards span', () => {
    expect(pickedSummary(['a', 'c'], rows)).toBe('2 moments · 0:15');
    expect(pickedSummary(['x'], [{ segment_id: 'x', start_s: 9, end_s: 3 }])).toBe('1 moment · 0:00');
  });
});

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
    const clip = { clip_id: 'c1', title: 'Coffee', filename: 'c.mp4', duration_s: 20, recorded_at: null, status: 'ready' as const, thumb_url: null, segment_count: 2, people: [], duplicate_of: null, size_bytes: 0, project_ids: [], speech_count: 0, face_count: 0 };
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

describe('pickedAmong', () => {
  it('keeps the picks still shown, in pick order, and drops the rest', () => {
    const row = (segment_id: string) => parseResult({
      segment_id, clip_id: 'c', start_s: 0, end_s: 1, thumb_url: null, reason: null, score: 1,
      clip_filename: 'a.mp4', clip_title: 'A', recorded_at: null, faces: [],
    });
    const shown = [row('s1'), row('s3')].flatMap((r) => (r === null ? [] : [r]));

    expect(pickedAmong(['s3', 's2', 's1'], shown)).toEqual(['s3', 's1']);
  });
});

describe('tileClick', () => {
  it('toggles with ⌘', () => {
    expect(tileClick(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(tileClick(['a', 'b'], 'a', true)).toEqual(['b']);
  });

  it('selects only the clicked clip on a plain click (opening is a double click)', () => {
    expect(tileClick(['a', 'b'], 'c', false)).toEqual(['c']);
  });
});

describe('menuTargets', () => {
  it('acts on the whole selection when the tile is one of several selected', () => {
    expect(menuTargets(['a', 'b', 'c'], 'b')).toEqual(['a', 'b', 'c']);
  });

  it('acts on the tile alone when it is not selected or selected alone', () => {
    expect(menuTargets(['a', 'b'], 'c')).toEqual(['c']);
    expect(menuTargets(['c'], 'c')).toEqual(['c']);
    expect(menuTargets([], 'c')).toEqual(['c']);
  });
});

describe('handoffFromRange', () => {
  it('hands over only the moments the range touches, in clip order', () => {
    const clip = { clip_id: 'c1', title: 'Coffee', filename: 'c.mp4', duration_s: 20, recorded_at: null, status: 'ready' as const, thumb_url: null, segment_count: 3, people: [], duplicate_of: null, size_bytes: 0, project_ids: [], speech_count: 0, face_count: 0 };
    const segment = (segment_id: string, start_s: number) => ({
      segment_id,
      idx: 0,
      start_s,
      end_s: start_s + 5,
      description: null,
      actions: [],
      objects: [],
      place: null,
      mood: null,
      quality: null,
      hook_score: null,
      thumb_url: null,
    });
    const segments = [segment('s1', 0), segment('s2', 5), segment('s3', 10)];

    expect(handoffFromRange({ clip, segments }, { start_s: 6, end_s: 11 }).segmentIds).toEqual(['s2', 's3']);
    expect(handoffFromRange({ clip, segments }, { start_s: 15, end_s: 18 }).segmentIds).toEqual([]);
  });
});

describe('selectModeClick', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('ticks and unticks a clip with a plain click, moving the anchor to it', () => {
    const once = selectModeClick({ selected: [], anchor: null }, 'b', order, false);
    expect(once).toEqual({ selected: ['b'], anchor: 'b' });
    expect(selectModeClick(once, 'b', order, false)).toEqual({ selected: [], anchor: 'b' });
  });

  it('ticks the range from the anchor with Shift, either way, keeping earlier ticks and the anchor', () => {
    expect(selectModeClick({ selected: ['a', 'b'], anchor: 'b' }, 'd', order, true)).toEqual({ selected: ['a', 'b', 'c', 'd'], anchor: 'b' });
    expect(selectModeClick({ selected: ['d'], anchor: 'd' }, 'b', order, true)).toEqual({ selected: ['d', 'b', 'c'], anchor: 'd' });
  });

  it('treats Shift as a plain tick with no anchor or an anchor no longer shown', () => {
    expect(selectModeClick({ selected: [], anchor: null }, 'c', order, true)).toEqual({ selected: ['c'], anchor: 'c' });
    expect(selectModeClick({ selected: ['z'], anchor: 'z' }, 'c', order, true)).toEqual({ selected: ['z', 'c'], anchor: 'c' });
  });
});

describe('clipsSelectedLine', () => {
  it('counts the selected clips, singular for one', () => {
    expect(clipsSelectedLine(3)).toBe('3 clips selected');
    expect(clipsSelectedLine(1)).toBe('1 clip selected');
    expect(clipsSelectedLine(0)).toBe('0 clips selected');
  });
});
