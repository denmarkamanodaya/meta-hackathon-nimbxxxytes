import { describe, expect, it } from 'vitest';
import { CAPTION_FILL, captionWordPaint } from './style.ts';

describe('captionWordPaint', () => {
  it('draws the word being said in the accent and every other word white, all with the same outline', () => {
    const active = captionWordPaint(true, '#FFE58A');
    const idle = captionWordPaint(false, '#FFE58A');

    expect(active.color).toBe('#FFE58A');
    expect(idle.color).toBe(CAPTION_FILL);
    expect(active.stroke).toBe(idle.stroke);
  });
});
