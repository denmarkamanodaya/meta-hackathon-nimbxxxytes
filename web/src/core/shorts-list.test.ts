import { describe, expect, it } from 'vitest';
import {
  draftLabel,
  filterShorts,
  scoreLabel,
  selectedShortLine,
  shortChip,
  shortsCountLine,
  shortSubLine,
  shortTitle,
} from './shorts-list';

const rows = [
  { short_id: 'a', status: 'ready' as const, production_id: null },
  { short_id: 'b', status: 'rendering' as const, production_id: 'p1' },
  { short_id: 'c', status: 'failed' as const, production_id: null },
];

describe('filterShorts', () => {
  it('keeps every short for All, in order', () => {
    expect(filterShorts(rows, 'all').map((r) => r.short_id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps only ready shorts for Ready', () => {
    expect(filterShorts(rows, 'ready').map((r) => r.short_id)).toEqual(['a']);
  });

  it('keeps only story cuts of a production for From productions', () => {
    expect(filterShorts(rows, 'productions').map((r) => r.short_id)).toEqual(['b']);
  });
});

describe('shortTitle', () => {
  it('is the post caption, else the prompt', () => {
    expect(shortTitle({ caption: 'my old soul napping', prompt: '3 second short' })).toBe('my old soul napping');
    expect(shortTitle({ caption: null, prompt: '3 second short' })).toBe('3 second short');
  });
});

describe('shortsCountLine', () => {
  it('counts the shorts, singular for one', () => {
    expect(shortsCountLine(2)).toBe('2 shorts · newest first');
    expect(shortsCountLine(1)).toBe('1 short · newest first');
  });
});

describe('shortChip', () => {
  it('is green Ready, red Failed, and a busy neutral chip while the editor works', () => {
    expect(shortChip('ready')).toEqual({ label: 'Ready', tone: 'success', isBusy: false });
    expect(shortChip('failed')).toEqual({ label: 'Failed', tone: 'danger', isBusy: false });
    expect(shortChip('rendering')).toEqual({ label: 'Rendering', tone: 'neutral', isBusy: true });
    expect(shortChip('revising')).toEqual({ label: 'Revising', tone: 'neutral', isBusy: true });
  });
});

describe('draftLabel and scoreLabel', () => {
  it('names the latest draft, or says there is none', () => {
    expect(draftLabel(2)).toBe('Draft 2');
    expect(draftLabel(0)).toBe('No draft');
  });

  it('shows the score out of 50, a dash before any score', () => {
    expect(scoreLabel(43.6)).toBe('44 / 50');
    expect(scoreLabel(null)).toBe('– / 50');
  });
});

describe('shortSubLine', () => {
  const row = { prompt: '3 second short', caption: 'my old soul', production_title: null, created_at: '2026-10-28T09:00:00Z' };

  it('names the production a story short came from', () => {
    expect(shortSubLine({ ...row, production_title: 'Sixty and shining' }, 'UTC')).toBe(
      'From production “Sixty and shining” · made 28 Oct 2026',
    );
  });

  it('quotes the prompt when the title is the post caption', () => {
    expect(shortSubLine(row, 'UTC')).toBe('“3 second short” · made 28 Oct 2026');
  });

  it('shows only the date when the title is already the prompt', () => {
    expect(shortSubLine({ ...row, caption: null }, 'UTC')).toBe('Made 28 Oct 2026');
  });
});

describe('selectedShortLine', () => {
  it('joins frame, length, draft and status', () => {
    expect(selectedShortLine({ aspect: '4:5', target_s: 60, version_count: 1, status: 'rendering' })).toBe(
      '4:5 · 1:00 · Draft 1 · Rendering',
    );
  });
});
