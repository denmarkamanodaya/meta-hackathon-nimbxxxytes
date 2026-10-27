import { describe, expect, it } from 'vitest';
import sample from '../fixtures/props.sample.json';
import { BLUR_PAD, boxAt, coverRect, padBox } from './blur.ts';
import { ShortPropsSchema } from './composition/schema.ts';

const box = (t_s: number, x: number, w = 0.1) => ({ t_s, x, y: 0.2, w, h: 0.1 });

describe('boxAt', () => {
  const boxes = [box(2, 0.1), box(3, 0.3), box(7, 0.5)];

  it('blends neighbouring seconds linearly', () => {
    expect(boxAt(boxes, 2)?.x).toBeCloseTo(0.1);
    expect(boxAt(boxes, 2.5)?.x).toBeCloseTo(0.2);
    expect(boxAt(boxes, 2.75)?.x).toBeCloseTo(0.25);
  });

  it('shows nothing before the first sample and holds the last for one second', () => {
    expect(boxAt(boxes, 1.9)).toBeNull();
    expect(boxAt(boxes, 7.9)?.x).toBeCloseTo(0.5);
    expect(boxAt(boxes, 8)).toBeNull();
    expect(boxAt([], 1)).toBeNull();
  });

  it('does not bridge a gap longer than two seconds', () => {
    expect(boxAt(boxes, 3.5)?.x).toBeCloseTo(0.3);
    expect(boxAt(boxes, 4.5)).toBeNull();
    expect(boxAt(boxes, 7)?.x).toBeCloseTo(0.5);
  });
});

describe('padBox', () => {
  it('adds 30 % of the longer side on every side, in frame pixels', () => {
    // A 9:16 frame: w 0.2 of the width is 0.1125 of the height, so h (0.2) is the longer side.
    const r = padBox({ x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, 9 / 16);
    const padY = BLUR_PAD * 0.2;
    expect(r.y).toBeCloseTo(0.4 - padY);
    expect(r.h).toBeCloseTo(0.2 + 2 * padY);
    expect(r.x).toBeCloseTo(0.4 - padY / (9 / 16));
  });

  it('stays inside the frame', () => {
    const r = padBox({ x: 0, y: 0.95, w: 0.1, h: 0.05 }, 1);
    expect(r.x).toBe(0);
    expect(r.y + r.h).toBeCloseTo(1);
  });
});

describe('coverRect', () => {
  it('maps a portrait source onto a 4:5 frame, cropping top and bottom', () => {
    // 9:16 at 1080 wide is 1920 tall, centred in 1350: 285 px cut off at the top.
    const r = coverRect({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 9 / 16, { width: 1080, height: 1350 });
    expect(r.left).toBeCloseTo(540);
    expect(r.top).toBeCloseTo(-285 + 960);
    expect(r.width).toBeCloseTo(108);
    expect(r.height).toBeCloseTo(192);
  });

  it('maps a landscape source onto a square frame, cropping the sides', () => {
    const r = coverRect({ x: 0, y: 0, w: 1, h: 1 }, 16 / 9, { width: 1080, height: 1080 });
    expect(r.left).toBeCloseTo(-(1920 - 1080) / 2);
    expect(r.top).toBeCloseTo(0);
    expect(r.height).toBeCloseTo(1080);
  });
});

describe('blur props', () => {
  it('are optional, so the shared fixture stays valid without them', () => {
    expect(ShortPropsSchema.safeParse(sample).success).toBe(true);
    expect('blur' in sample).toBe(false);
  });

  it('take boxes as shares of the frame, at least one per face', () => {
    const face = { segment_id: 'seg_coffee', aspect: 0.5625, boxes: [box(3, 0.4)] };
    const ok = (blur: unknown) => ShortPropsSchema.safeParse({ ...sample, blur }).success;
    expect(ok([face])).toBe(true);
    expect(ok([{ ...face, boxes: [] }])).toBe(false);
    expect(ok([{ ...face, boxes: [box(3, 1.2)] }])).toBe(false);
    expect(ok([{ ...face, aspect: 0 }])).toBe(false);
  });
});
