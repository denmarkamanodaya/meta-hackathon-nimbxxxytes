import { describe, expect, it } from 'vitest';
import {
  addSuggestion,
  canMakeMoreCovers,
  canRedraw,
  canSaveTitle,
  captionCount,
  clampCoverTitle,
  coverCountLine,
  coverTiles,
  macRenderLine,
  postText,
  publishStepLine,
  renderLine,
  renderSharedLine,
  renderStatusWord,
  titleOverlay,
  withoutHashtag,
} from './publish';
import type { CoverStyle, CoverTile, CoverTitle } from '../services/api/types';

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

const cover = (url: string, style: CoverStyle = 'bright', instruction: string | null = null): CoverTile => ({ url, style, instruction, background: null });

describe('coverTiles', () => {
  it('marks the picked cover', () => {
    expect(coverTiles([cover('a'), cover('b'), cover('c')], 1).map((t) => t.isPicked)).toEqual([false, true, false]);
  });

  it('marks the first cover when the pick is out of range', () => {
    expect(coverTiles([cover('a'), cover('b')], 5).map((t) => t.isPicked)).toEqual([true, false]);
    expect(coverTiles([], 0)).toEqual([]);
  });

  it('names each tile by its place and style, with the words of a redrawn cover', () => {
    const tiles = coverTiles(
      [cover('a'), cover('b', 'close_detail'), cover('c', 'redrawn', 'golden hour'), cover('d', 'key_art'), cover('e', 'redrawn')],
      0,
    );

    expect(tiles.map((t) => t.label)).toEqual(['1 · Bright', '2 · Close detail', '3 · Redrawn: golden hour', '4 · Key art', '5 · Redrawn']);
  });
});

describe('cover title', () => {
  const saved: CoverTitle = { text: 'Nap champion', show: true, position: 'bottom' };

  it('shows the typed text over the saved one, trimmed and cut to 32 characters', () => {
    expect(titleOverlay(saved, null)).toEqual({ text: 'Nap champion', position: 'bottom' });
    expect(titleOverlay({ ...saved, position: 'top' }, '  Old soul  ')).toEqual({ text: 'Old soul', position: 'top' });
    expect(titleOverlay(saved, 'a'.repeat(40))?.text).toHaveLength(32);
  });

  it('shows nothing when the title is off or empty', () => {
    expect(titleOverlay({ ...saved, show: false }, null)).toBeNull();
    expect(titleOverlay(saved, '   ')).toBeNull();
  });

  it('clamps by character, so an emoji is never cut in half', () => {
    expect(Array.from(clampCoverTitle('🐶'.repeat(40)))).toHaveLength(32);
  });

  it('saves 1–32 changed characters only', () => {
    expect(canSaveTitle('Old soul', 'Nap champion')).toBe(true);
    expect(canSaveTitle(' Nap champion ', 'Nap champion')).toBe(false);
    expect(canSaveTitle('   ', 'Nap champion')).toBe(false);
    expect(canSaveTitle('a'.repeat(33), 'Nap champion')).toBe(false);
  });
});

describe('Mac render row and cover count', () => {
  it('reads as on the board', () => {
    expect(macRenderLine('9:16', { lengthS: 10.4, captionsOn: true })).toBe('9:16 render · 0:10');
    expect(macRenderLine('4:5', null)).toBe('4:5 render');
    expect(renderSharedLine('9:16')).toBe('Shared by TikTok, Reels and Shorts');
    expect(renderSharedLine('4:5')).toBe("Feed only, in the short's 4:5");
    expect(renderStatusWord('ready')).toBe('Ready');
    expect(coverCountLine(4)).toBe('4 of 9 · drawn by Muse Image from your hook frame');
  });
});

describe('redraw words', () => {
  it('takes 3–120 characters below the cap while nothing runs', () => {
    expect(canRedraw('golden hour', 4, false)).toBe(true);
    expect(canRedraw('ab', 4, false)).toBe(false);
    expect(canRedraw('a'.repeat(121), 4, false)).toBe(false);
    expect(canRedraw('golden hour', 9, false)).toBe(false);
    expect(canRedraw('golden hour', 4, true)).toBe(false);
  });

  it('adds a suggestion once, after what is typed', () => {
    expect(addSuggestion('', 'moodier')).toBe('moodier');
    expect(addSuggestion('golden hour light', 'moodier')).toBe('golden hour light, moodier');
    expect(addSuggestion('Golden Hour light', 'golden hour')).toBe('Golden Hour light');
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

describe('publishStepLine', () => {
  it('names each step, a failure and an unknown step', () => {
    expect(publishStepLine('pack', 'running')).toBe('Writing captions and hashtags');
    expect(publishStepLine('render', 'failed')).toBe('Publishing stopped. Try again.');
    expect(publishStepLine('later', 'running')).toBe('Working on it');
    expect(publishStepLine(null, null)).toBe('Working on it');
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
