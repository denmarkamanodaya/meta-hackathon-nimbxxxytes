import { describe, expect, it } from 'vitest';
import { canMakeMoreCovers, captionCount, coverTiles, postText, renderLine, withoutHashtag } from './publish';

describe('captionCount', () => {
  it('counts trimmed characters against the limit, with grouped numbers', () => {
    expect(captionCount('  Sunset ride  ', 2200)).toEqual({ count: 11, left: 2189, isOver: false, label: '11 / 2,200' });
  });

  it('is over once past the limit', () => {
    expect(captionCount('x'.repeat(101), 100)).toMatchObject({ count: 101, left: -1, isOver: true });
  });

  it('counts an emoji as one character, as the server does', () => {
    expect(captionCount('ok 👍', 100).count).toBe(4);
  });
});

describe('coverTiles', () => {
  it('marks the picked cover', () => {
    expect(coverTiles(['a', 'b', 'c'], 1).map((t) => t.isPicked)).toEqual([false, true, false]);
  });

  it('marks the first cover when the pick is out of range', () => {
    expect(coverTiles(['a', 'b'], 5).map((t) => t.isPicked)).toEqual([true, false]);
    expect(coverTiles([], 0)).toEqual([]);
  });
});

describe('canMakeMoreCovers', () => {
  it('stops at 9 covers and while a run is in flight', () => {
    expect(canMakeMoreCovers(6, false)).toBe(true);
    expect(canMakeMoreCovers(9, false)).toBe(false);
    expect(canMakeMoreCovers(3, true)).toBe(false);
  });
});

describe('hashtags and the copied text', () => {
  it('removes one tag', () => {
    expect(withoutHashtag(['#a', '#b', '#c'], '#b')).toEqual(['#a', '#c']);
  });

  it('puts the hashtags after a blank line, and copes with either part empty', () => {
    expect(postText(' Sunset ride ', ['#bike', '#sunset'])).toBe('Sunset ride\n\n#bike #sunset');
    expect(postText('Sunset ride', [])).toBe('Sunset ride');
    expect(postText('', ['#bike'])).toBe('#bike');
  });
});

describe('renderLine', () => {
  it('names the frame, the cut and the render state', () => {
    expect(renderLine({ aspect: '9:16', status: 'rendering' }, { lengthS: 57.6, captionsOn: true })).toBe(
      '9:16 · 58 s · captions on · Rendering',
    );
    expect(renderLine({ aspect: '4:5', status: 'ready' }, null)).toBe('4:5 · Ready');
  });
});
