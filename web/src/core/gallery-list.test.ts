import { describe, expect, it } from 'vitest';
import { GALLERY_SORT_PRESET } from './gallery';
import { GALLERY_LIST_COLUMNS, GALLERY_LIST_COLUMNS_NARROW, sortLabel, uploadRowSpans } from './gallery-list';

describe('Gallery list columns', () => {
  it('shows every column on a wide window', () => {
    expect(GALLERY_LIST_COLUMNS).toEqual(['name', 'recorded', 'length', 'size', 'type', 'moments', 'faces', 'where', 'project']);
  });

  it('leaves out Recorded and Size on a narrow window and keeps the order', () => {
    expect(GALLERY_LIST_COLUMNS_NARROW).toEqual(['name', 'length', 'type', 'moments', 'faces', 'where', 'project']);
  });

  it('spreads an upload row over Recorded and Length, Size, then the rest on a wide window', () => {
    expect(uploadRowSpans(GALLERY_LIST_COLUMNS)).toEqual({ progress: 2, hasSize: true, end: 5 });
  });

  it('spreads an upload row over Length, then the rest on a narrow window, the same width as a clip row', () => {
    const spans = uploadRowSpans(GALLERY_LIST_COLUMNS_NARROW);

    expect(spans).toEqual({ progress: 1, hasSize: false, end: 5 });
    expect(1 + spans.progress + (spans.hasSize ? 1 : 0) + spans.end).toBe(GALLERY_LIST_COLUMNS_NARROW.length);
  });

  it('names the sort button by the menu order, else the column and an arrow', () => {
    expect(sortLabel(GALLERY_SORT_PRESET.newest)).toBe('Newest first');
    expect(sortLabel({ by: 'size', dir: 'desc' })).toBe('Size ↓');
    expect(sortLabel({ by: 'type', dir: 'asc' })).toBe('Type ↑');
  });
});
