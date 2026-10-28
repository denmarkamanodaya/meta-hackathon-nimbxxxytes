import { describe, expect, it } from 'vitest';
import cutoutSample from '../../fixtures/cutout.sample.json';
import dog from '../../fixtures/sam_mask_dog.json';
import { boxSize, CutoutPropsSchema, cutoutCanvas, cutoutPlacement, STICKER_PAD } from './cutout.ts';

describe('boxSize', () => {
  it('counts both corners, as SAM sends the raster for an inclusive box', () => {
    expect(boxSize(dog.box)).toEqual({ width: dog.mask.width, height: dog.mask.height });
  });
});

describe('cutoutCanvas', () => {
  it('is the box itself for a plain cut-out', () => {
    expect(cutoutCanvas(dog.box, false)).toEqual({ width: 224, height: 277, placement: { left: 0, top: 0, scale: 1 } });
  });

  it('adds the sticker padding on every side', () => {
    expect(cutoutCanvas(dog.box, true)).toEqual({
      width: 224 + 2 * STICKER_PAD,
      height: 277 + 2 * STICKER_PAD,
      placement: { left: 12, top: 12, scale: 1 },
    });
  });
});

describe('cutoutPlacement', () => {
  it('scales a tall subject to 64 % of the cover height and stands it bottom-centre', () => {
    const at = cutoutPlacement(dog.box, { width: 1080, height: 1920 });

    expect(at.scale).toBeCloseTo((1920 * 0.64) / 277, 9);
    expect(277 * at.scale).toBeCloseTo(1228.8, 6);
    expect(at.top + 277 * at.scale).toBeCloseTo(1920, 9);
    expect(at.left + (224 * at.scale) / 2).toBeCloseTo(540, 9);
  });

  it('shrinks a wide subject to the cover width so none of it is cut off', () => {
    const at = cutoutPlacement({ x1: 0, y1: 100, x2: 399, y2: 199 }, { width: 1080, height: 1920 });

    expect(at.scale).toBeCloseTo(1080 / 400, 9);
    expect(at.left).toBeCloseTo(0, 9);
    expect(at.top + 100 * at.scale).toBeCloseTo(1920, 9);
  });
});

describe('CutoutPropsSchema', () => {
  it('accepts the Studio sample', () => {
    expect(CutoutPropsSchema.safeParse(cutoutSample).success).toBe(true);
  });

  it('refuses a path with anything but M/L/Z data, so nothing can break out of the CSS', () => {
    expect(CutoutPropsSchema.safeParse({ ...cutoutSample, path: "M0 0Z'); background: url(x" }).success).toBe(false);
  });

  it('refuses a box outside the frame', () => {
    expect(CutoutPropsSchema.safeParse({ ...cutoutSample, frame: { w: 84, h: 640 } }).success).toBe(false);
  });
});
