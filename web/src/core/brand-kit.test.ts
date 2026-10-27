import { describe, expect, it } from 'vitest';
import {
  addColor,
  canRemoveColor,
  checkBrandImage,
  isSavableColorList,
  normalizeColor,
  removeColor,
  replaceColor,
} from './brand-kit';

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
