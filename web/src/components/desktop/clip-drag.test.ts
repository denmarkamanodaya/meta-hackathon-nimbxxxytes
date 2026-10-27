import { describe, expect, it } from 'vitest';
import { CLIP_DRAG_TYPE, isClipDrag, readClipDrag, writeClipDrag, type DragData } from './clip-drag';

function fakeData(initial: Record<string, string> = {}): DragData {
  const store = new Map(Object.entries(initial));
  return {
    get types() {
      return [...store.keys()];
    },
    getData: (format) => store.get(format) ?? '',
    setData: (format, value) => {
      store.set(format, value);
    },
    effectAllowed: 'all',
  };
}

describe('clip drag', () => {
  it('round-trips the clip ids under its own type and allows a copy', () => {
    const data = fakeData();
    writeClipDrag(data, ['a', 'b']);

    expect(isClipDrag(data)).toBe(true);
    expect(data.effectAllowed).toBe('copy');
    expect(readClipDrag(data)).toEqual(['a', 'b']);
  });

  it('reads nothing from a foreign drag or a malformed payload', () => {
    expect(isClipDrag(fakeData({ 'text/plain': 'hi' }))).toBe(false);
    expect(readClipDrag(fakeData({ 'text/plain': 'hi' }))).toEqual([]);
    expect(readClipDrag(fakeData({ [CLIP_DRAG_TYPE]: '{nope' }))).toEqual([]);
    expect(readClipDrag(fakeData({ [CLIP_DRAG_TYPE]: '["a", 3, null]' }))).toEqual(['a']);
  });
});
