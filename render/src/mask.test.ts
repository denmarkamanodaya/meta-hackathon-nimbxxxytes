import { describe, expect, it } from 'vitest';
import dog from '../fixtures/sam_mask_dog.json';
import plate from '../fixtures/sam_mask_plate.json';
import { MaskSchema, maskToFramePath, translatePath } from './mask.ts';

const numbers = (path: string, axis: 0 | 1): number[] =>
  [...path.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[axis + 1]));

describe('translatePath', () => {
  it('moves every M and L point and keeps Z', () => {
    expect(translatePath('M0.5 0L1 -0.5L1.5 0ZM3 3L4 3Z', 10.5, 20.5)).toBe('M11 20.5L11.5 20L12 20.5ZM13.5 23.5L14.5 23.5Z');
  });

  it('returns an empty path unchanged', () => {
    expect(translatePath('', 5, 5)).toBe('');
  });

  it('refuses commands it does not know how to move', () => {
    expect(() => translatePath('M0 0H5Z', 1, 1)).toThrow(/M, L and Z/);
    expect(() => translatePath('M0 0C1 1 2 2 3 3Z', 1, 1)).toThrow(/M, L and Z/);
  });
});

describe('maskToFramePath on recorded SAM masks', () => {
  it('lays the dog image cutout along the pixel edges of its box on the 240x426 frame', () => {
    const result = maskToFramePath(MaskSchema.parse(dog.mask), dog.box);

    if (!result.ok) throw new Error(result.message);
    expect(result.path.startsWith('M')).toBe(true);
    expect(Math.min(...numbers(result.path, 0))).toBe(dog.box.x1);
    expect(Math.max(...numbers(result.path, 0))).toBe(dog.box.x2 + 1);
    expect(Math.min(...numbers(result.path, 1))).toBe(dog.box.y1);
    expect(Math.max(...numbers(result.path, 1))).toBe(dog.box.y2 + 1);
  });

  it('decodes the small plate mask from a video record', () => {
    const result = maskToFramePath(MaskSchema.parse(plate.mask), plate.box);

    expect(result).toMatchObject({ ok: true, path: expect.stringMatching(/^M51 329.5L51.5 329L/) as unknown });
  });

  it('refuses a mask whose raster is not the box', () => {
    const result = maskToFramePath(MaskSchema.parse(plate.mask), { ...plate.box, x2: plate.box.x2 + 1 });

    expect(result).toEqual({ ok: false, message: 'mask is 35x18, the box is not' });
  });

  it('refuses a payload that does not decode', () => {
    const result = maskToFramePath({ ...plate.mask, encoding: 'one_bit', payload: '!!!!!:"' }, plate.box);

    expect(result.ok).toBe(false);
  });
});
