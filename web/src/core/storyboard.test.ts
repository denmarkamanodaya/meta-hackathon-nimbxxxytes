import { describe, expect, it } from 'vitest';
import type { ProductionShot, ShotMatch } from '../services/api/types';
import { boardNote, boardShown,defaultBoardView, hasFootageBoard, isDrawingFootage, rowBoardUrl } from './storyboard';

const match: ShotMatch = {
  segment_id: 'seg',
  clip_id: 'clip',
  clip_title: '60th birthday',
  start_s: 43,
  end_s: 49,
  recorded_at: null,
  description: 'Smiles on the sofa',
  thumb_url: 'thumb',
};

const shot = (over: Partial<ProductionShot> = {}): Pick<ProductionShot, 'board_url' | 'footage_board_url' | 'match' | 'take_count'> => ({
  board_url: 'planned.webp',
  footage_board_url: 'footage.webp',
  match,
  take_count: 3,
  ...over,
});

describe('footage boards', () => {
  it('badges and shows the footage board only on a covered shot that has one', () => {
    expect(hasFootageBoard(shot())).toBe(true);
    expect(rowBoardUrl(shot())).toBe('footage.webp');
    expect(hasFootageBoard(shot({ footage_board_url: null }))).toBe(false);
    expect(rowBoardUrl(shot({ footage_board_url: null }))).toBe('planned.webp');
    expect(hasFootageBoard(shot({ match: null }))).toBe(false);
    expect(rowBoardUrl(shot({ match: null }))).toBe('planned.webp');
  });

  it('opens a covered shot on its footage board, a missing one on the plan', () => {
    expect(defaultBoardView(shot())).toBe('footage');
    expect(defaultBoardView(shot({ match: null }))).toBe('planned');
  });

  it('says where each board came from', () => {
    expect(boardShown(shot(), 'footage')).toEqual({
      url: 'footage.webp',
      isFootage: true,
      caption: 'Drawn by Muse Image from your footage at 60th birthday · 0:43–0:49 · 3 takes',
    });
    expect(boardShown(shot(), 'planned')).toEqual({ url: 'planned.webp', isFootage: false, caption: 'Planned sketch, drawn before filming' });
    expect(boardShown(shot({ match: null }), 'footage').isFootage).toBe(false);
    expect(boardShown(shot({ footage_board_url: null }), 'footage').url).toBe('planned.webp');
  });

  it('notes each row: from footage, drawing, or planned and still to film', () => {
    expect(boardNote(shot(), false)).toEqual({ text: 'Board from your footage', tone: 'secondary' });
    expect(boardNote(shot(), true)).toEqual({ text: 'Drawing from footage…', tone: 'accent' });
    expect(boardNote(shot({ match: null, footage_board_url: null }), false)).toEqual({ text: 'Planned sketch · Film it', tone: 'warning' });
    expect(boardNote(shot({ footage_board_url: null }), false)).toBeNull();
  });

  it('draws while a run is in flight for a requested shot or a covered shot without a board', () => {
    expect(isDrawingFootage(shot(), true, true)).toBe(true);
    expect(isDrawingFootage(shot(), true, false)).toBe(false);
    expect(isDrawingFootage(shot({ footage_board_url: null }), true, false)).toBe(true);
    expect(isDrawingFootage(shot(), false, true)).toBe(false);
    expect(isDrawingFootage(shot({ match: null }), true, true)).toBe(false);
  });
});
