import { describe, expect, it } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { coverRect } from './blur.ts';
import { ShortClipSchema, ShortPropsSchema, type ShortClip } from './composition/schema.ts';
import { CENTRED, centreAt, clipFraming, coverPlacement, videoBox } from './crop.ts';

const path = [
  { t_s: 10, cx: 0.2, cy: 0.5 },
  { t_s: 12, cx: 0.6, cy: 0.3 },
  { t_s: 13, cx: 0.6, cy: 0.3 },
];

describe('centreAt', () => {
  it('holds the first keyframe before the path starts', () => {
    expect(centreAt(path, 4)).toEqual({ cx: 0.2, cy: 0.5 });
  });

  it('blends linearly between keyframes', () => {
    const at = centreAt(path, 11);
    expect(at.cx).toBeCloseTo(0.4, 12);
    expect(at.cy).toBeCloseTo(0.4, 12);
  });

  it('lands on a keyframe exactly at its time', () => {
    expect(centreAt(path, 12)).toEqual({ cx: 0.6, cy: 0.3 });
  });

  it('holds the last keyframe after the path ends, and a single keyframe everywhere', () => {
    expect(centreAt(path, 99)).toEqual({ cx: 0.6, cy: 0.3 });
    expect(centreAt([{ t_s: 5, cx: 0.7, cy: 0.1 }], 0)).toEqual({ cx: 0.7, cy: 0.1 });
    expect(centreAt([{ t_s: 5, cx: 0.7, cy: 0.1 }], 9)).toEqual({ cx: 0.7, cy: 0.1 });
  });
});

// A 3:4 glasses source in a 9:16 export frame: 1440 wide when scaled to 1920 tall.
const frame = { width: 1080, height: 1920 };
const portrait = 3 / 4;

describe('coverPlacement', () => {
  it('centres the source when no centre is given (the old cover crop)', () => {
    expect(coverPlacement(portrait, frame)).toEqual({ left: -180, top: 0, width: 1440, height: 1920 });
    expect(coverPlacement(portrait, frame, CENTRED)).toEqual(coverPlacement(portrait, frame));
  });

  it('puts the crop centre at the frame centre', () => {
    const at = coverPlacement(portrait, frame, { cx: 0.45, cy: 0.5 });
    expect(at.left + 0.45 * at.width).toBeCloseTo(540, 9);
    expect(at.left).toBeCloseTo(-108, 9);
  });

  it('clamps at the left and right edges so no empty edge shows', () => {
    expect(coverPlacement(portrait, frame, { cx: 0.05, cy: 0.5 }).left).toBe(0);
    expect(coverPlacement(portrait, frame, { cx: 0.98, cy: 0.5 }).left).toBe(1080 - 1440);
  });

  it('clamps vertically too, and cannot move an axis the source only just covers', () => {
    // 16:9 in 4:5 is shown 2400 x 1350: exactly the frame's height, so it cannot move up or down.
    const wide = coverPlacement(16 / 9, { width: 1080, height: 1350 }, { cx: 0.5, cy: 0.0 });
    expect(wide.top).toBe(0);
    const tall = coverPlacement(9 / 16, { width: 1080, height: 1350 }, { cx: 0.5, cy: 1 });
    expect(tall.top).toBeCloseTo(1350 - 1920, 9);
    expect(tall.left).toBe(0);
  });
});

const clip = (extra: Partial<ShortClip> = {}): ShortClip => ({
  segment_id: 'seg_a',
  src_url: 'https://media.example/a.mp4',
  in_s: 10,
  out_s: 13,
  punch_in: 1.2,
  subject: 'the dog',
  captions: [],
  ...extra,
});

describe('clipFraming', () => {
  it('is null without a crop_path, so the shot keeps the centred cover exactly as before', () => {
    expect(clipFraming(clip(), frame, 11)).toBeNull();
    expect(videoBox(null)).toEqual({ width: '100%', height: '100%', objectFit: 'cover' });
  });

  it('places the source by the interpolated centre and zooms around the subject', () => {
    const framing = clipFraming(clip({ crop_path: path, source_aspect: portrait }), frame, 11);

    expect(framing?.centre.cx).toBeCloseTo(0.4, 12);
    expect(framing?.video.left).toBeCloseTo(540 - 0.4 * 1440, 9);
    expect(framing?.origin.x).toBeCloseTo(540, 9);
    expect(framing?.origin.y).toBeCloseTo(0.4 * 1920, 9);
    expect(framing && videoBox(framing)).toEqual({ position: 'absolute', ...framing?.video, objectFit: 'cover' });
  });

  it('keeps the zoom on the subject when the crop is clamped at an edge', () => {
    const framing = clipFraming(clip({ crop_path: [{ t_s: 0, cx: 0.02, cy: 0.5 }], source_aspect: portrait }), frame, 11);

    expect(framing?.video.left).toBe(0);
    expect(framing?.origin.x).toBeCloseTo(0.02 * 1440, 9);
  });
});

describe('coverRect follows the crop', () => {
  it('keeps the blur on a face at the crop centre at the frame centre', () => {
    const face = { x: 0.4, y: 0.4, w: 0.1, h: 0.1 };
    const r = coverRect(face, portrait, frame, { cx: 0.45, cy: 0.45 });

    expect(r.left + r.width / 2).toBeCloseTo(540, 9);
    expect(r.width).toBeCloseTo(144, 9);
  });

  it('maps exactly as before without a centre', () => {
    expect(coverRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, portrait, frame)).toEqual({ left: 540, top: 960, width: 144, height: 192 });
  });
});

describe('crop_path on the wire', () => {
  it('parses the shared fixture, whose crossing shot follows its subject', () => {
    const crossing = ShortPropsSchema.parse(sample).clips.find((c) => c.segment_id === 'seg_crossing');

    expect(crossing?.crop_path).toHaveLength(3);
    expect(crossing?.source_aspect).toBe(0.75);
  });

  it('refuses a crop_path without source_aspect, out of time order, or off the source', () => {
    const base = clip({ crop_path: path, source_aspect: portrait });

    expect(ShortClipSchema.safeParse(base).success).toBe(true);
    expect(ShortClipSchema.safeParse({ ...base, source_aspect: undefined }).success).toBe(false);
    expect(ShortClipSchema.safeParse({ ...base, crop_path: [...path].reverse() }).success).toBe(false);
    expect(ShortClipSchema.safeParse({ ...base, crop_path: [{ t_s: 1, cx: 1.2, cy: 0.5 }] }).success).toBe(false);
    expect(ShortClipSchema.safeParse({ ...base, crop_path: [] }).success).toBe(false);
  });
});
