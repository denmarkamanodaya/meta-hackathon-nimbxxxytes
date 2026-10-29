import { describe, expect, it } from 'vitest';
import { GALLERY_LIST_COLUMNS, GALLERY_LIST_COLUMNS_NARROW, uploadRowSpans } from './gallery-list';

describe('Gallery list columns', () => {
  it('shows every column on a wide window', () => {
    expect(GALLERY_LIST_COLUMNS).toEqual(['name', 'recorded', 'length', 'size', 'moments', 'faces', 'where', 'project']);
  });

  it('leaves out Recorded and Size on a narrow window and keeps the order', () => {
    expect(GALLERY_LIST_COLUMNS_NARROW).toEqual(['name', 'length', 'moments', 'faces', 'where', 'project']);
  });

  it('spreads an upload row over Recorded and Length, Size, then the rest on a wide window', () => {
    expect(uploadRowSpans(GALLERY_LIST_COLUMNS)).toEqual({ progress: 2, hasSize: true, end: 4 });
  });

  it('spreads an upload row over Length, then the rest on a narrow window, the same width as a clip row', () => {
    const spans = uploadRowSpans(GALLERY_LIST_COLUMNS_NARROW);

    expect(spans).toEqual({ progress: 1, hasSize: false, end: 4 });
    expect(1 + spans.progress + (spans.hasSize ? 1 : 0) + spans.end).toBe(GALLERY_LIST_COLUMNS_NARROW.length);
  });
});
