import { describe, expect, it } from 'vitest';
import {
  addColor,
  canRemoveColor,
  checkBrandImage,
  colorInSlot,
  freeRefSlot,
  isSavableColorList,
  normalizeColor,
  removeColor,
  replaceColor,
  setColorSlot,
} from './brand-kit';

describe('freeRefSlot', () => {
  it('picks the lowest slot no kept reference uses, null when all 4 are taken', () => {
    expect(freeRefSlot([])).toBe(0);
    expect(freeRefSlot(['u/brand/ref_0.png', 'u/brand/ref_2.jpg'])).toBe(1);
    expect(freeRefSlot(['u/brand/ref_0.png', 'u/brand/ref_1.png', 'u/brand/ref_2.png', 'u/brand/ref_3.png'])).toBeNull();
  });
});

describe('checkBrandImage', () => {
  it('takes a PNG or JPG up to 5 MB', () => {
    expect(checkBrandImage({ type: 'image/png', size: 5 * 1024 * 1024 })).toEqual({ ok: true, type: 'image/png' });
    expect(checkBrandImage({ type: 'image/jpeg', size: 10 })).toEqual({ ok: true, type: 'image/jpeg' });
  });

  it('refuses other types and larger files', () => {
    expect(checkBrandImage({ type: 'image/webp', size: 10 })).toEqual({ ok: false, reason: 'Use a PNG or JPG image.' });
    expect(checkBrandImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 })).toEqual({
      ok: false,
      reason: 'Use an image up to 5 MB.',
    });
  });
});

describe('normalizeColor', () => {
  it('lower-cases, trims and adds the #', () => {
    expect(normalizeColor(' #0B6E85 ')).toBe('#0b6e85');
    expect(normalizeColor('ffe58a')).toBe('#ffe58a');
  });

  it('rejects anything but 6 hex digits', () => {
    expect(normalizeColor('#fff')).toBeNull();
    expect(normalizeColor('teal')).toBeNull();
  });
});

describe('addColor', () => {
  it('adds at the end, at most 3, each once', () => {
    expect(addColor(['#0b6e85'], '#FFE58A')).toEqual(['#0b6e85', '#ffe58a']);
    expect(addColor(['#0b6e85'], '#0B6E85')).toEqual(['#0b6e85']);
    expect(addColor(['#000001', '#000002', '#000003'], '#000004')).toHaveLength(3);
    expect(addColor([], 'nope')).toEqual([]);
  });
});

describe('replaceColor', () => {
  it('changes one swatch, never into a duplicate of another', () => {
    expect(replaceColor(['#000001', '#000002'], 1, '#00000A')).toEqual(['#000001', '#00000a']);
    expect(replaceColor(['#000001', '#000002'], 1, '#000001')).toEqual(['#000001', '#000002']);
  });
});

describe('removeColor', () => {
  it('keeps at least one colour; the next one becomes the accent', () => {
    expect(removeColor(['#000001', '#000002'], 0)).toEqual(['#000002']);
    expect(removeColor(['#000001'], 0)).toEqual(['#000001']);
    expect(canRemoveColor(['#000001'])).toBe(false);
  });
});

describe('isSavableColorList', () => {
  it('needs 1 to 3 normalised, distinct colours', () => {
    expect(isSavableColorList(['#0b6e85'])).toBe(true);
    expect(isSavableColorList([])).toBe(false);
    expect(isSavableColorList(['#0B6E85'])).toBe(false);
    expect(isSavableColorList(['#000001', '#000001'])).toBe(false);
  });
});

describe('three-slot colour editor', () => {
  const starters = ['#1ed2dc', '#ffe58a', '#ffffff'];

  it('shows the kit colour in a slot, else the starter', () => {
    expect(colorInSlot(['#112233'], starters, 0)).toBe('#112233');
    expect(colorInSlot(['#112233'], starters, 2)).toBe('#ffffff');
    expect(colorInSlot([], [], 1)).toBe('');
  });

  it('sets a slot inside the kit in place', () => {
    expect(setColorSlot(['#112233', '#445566'], starters, 1, '#ABCDEF')).toEqual(['#112233', '#abcdef']);
  });

  it('fills the slots before a later one with their starters, so the list has no hole', () => {
    expect(setColorSlot(['#112233'], starters, 2, '#000000')).toEqual(['#112233', '#ffe58a', '#000000']);
  });

  it('changes nothing for an invalid colour, a used colour or a slot past three', () => {
    expect(setColorSlot(['#112233'], starters, 0, 'teal')).toEqual(['#112233']);
    expect(setColorSlot(['#112233', '#445566'], starters, 1, '#112233')).toEqual(['#112233', '#445566']);
    expect(setColorSlot(['#112233'], starters, 3, '#000000')).toEqual(['#112233']);
  });
});
