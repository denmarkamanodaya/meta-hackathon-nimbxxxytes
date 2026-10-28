// Pure rules for a shot's two storyboards: the planned sketch drawn before filming, and the board
// redrawn from the covering moment's hook frame ("From your footage"). Which one a row and the
// right column show, the caption under it, and when a footage board is being drawn.
import type { ProductionShot } from '../services/api/types';
import { footageCaption, MUSE_IMAGE_COPY } from './copy';
import { matchLine } from './production-view';

/** Which storyboard the right column shows. */
export type BoardView = 'planned' | 'footage';

type BoardShot = Pick<ProductionShot, 'board_url' | 'footage_board_url' | 'match' | 'take_count'>;

/**
 * Whether a shot's row carries the "Drawn from your footage" badge.
 * @param shot - The shot.
 * @returns True for a covered shot whose footage board is drawn.
 */
export const hasFootageBoard = (shot: Pick<ProductionShot, 'footage_board_url' | 'match'>): boolean =>
  shot.match !== null && shot.footage_board_url !== null;

/**
 * The frame a shot's row shows: the footage board once drawn, else the planned sketch.
 * @param shot - The shot.
 * @returns The image URL, or null while nothing is drawn.
 */
export const rowBoardUrl = (shot: BoardShot): string | null => (hasFootageBoard(shot) ? shot.footage_board_url : shot.board_url);

/**
 * The view a shot opens on: From your footage when it is covered, else Planned.
 * @param shot - The shot.
 * @returns The view.
 */
export const defaultBoardView = (shot: Pick<ProductionShot, 'match'>): BoardView => (shot.match === null ? 'planned' : 'footage');

/**
 * Whether a covered shot's footage board is being drawn: one the user asked to redraw while a run
 * is in flight, or a covered shot without one while the coverage run draws it.
 * @param shot - The shot.
 * @param isBusy - A coverage or board run is in flight.
 * @param isRequested - The user asked to redraw this shot's board.
 * @returns True while it is being drawn.
 */
export function isDrawingFootage(shot: Pick<ProductionShot, 'footage_board_url' | 'match'>, isBusy: boolean, isRequested: boolean): boolean {
  if (shot.match === null || !isBusy) return false;
  return isRequested || shot.footage_board_url === null;
}

/** A shot row's board note and its colour role. */
export interface BoardNote {
  text: string;
  tone: 'secondary' | 'accent' | 'warning';
}

/**
 * The note at the end of a shot row: where its board came from, or that it is being drawn.
 * @param shot - The shot.
 * @param isDrawing - Its footage board is being drawn.
 * @returns The note, or null for a covered shot whose footage board is not drawn yet.
 */
export function boardNote(shot: Pick<ProductionShot, 'footage_board_url' | 'match'>, isDrawing: boolean): BoardNote | null {
  if (shot.match === null) return { text: MUSE_IMAGE_COPY.plannedFilmIt, tone: 'warning' };
  if (isDrawing) return { text: MUSE_IMAGE_COPY.drawingRowNote, tone: 'accent' };
  return shot.footage_board_url === null ? null : { text: MUSE_IMAGE_COPY.boardFromFootage, tone: 'secondary' };
}

/** The large storyboard in the right column. */
export interface BoardShown {
  url: string | null;
  isFootage: boolean;
  caption: string;
}

/**
 * The right column's storyboard for a view. A covered shot whose footage board is not drawn yet
 * shows its planned sketch under the footage caption until it lands.
 * @param shot - The shot.
 * @param view - The picked view.
 * @returns The image, whether it is from footage, and the caption under it.
 */
export function boardShown(shot: BoardShot, view: BoardView): BoardShown {
  const match = shot.match;
  if (view === 'planned' || match === null) {
    return { url: shot.board_url, isFootage: false, caption: MUSE_IMAGE_COPY.plannedCaption };
  }
  return {
    url: shot.footage_board_url ?? shot.board_url,
    isFootage: true,
    caption: footageCaption(matchLine(match, shot.take_count)),
  };
}
