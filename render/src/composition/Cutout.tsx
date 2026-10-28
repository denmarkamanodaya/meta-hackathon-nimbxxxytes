// The Cutout still: the subject alone on a transparent canvas cropped to its box. The sticker
// look adds padding and a white outline made of four stacked drop-shadows (each one shadows the
// result of the last, so together they ring the whole shape).
import { AbsoluteFill } from 'remotion';
import { cutoutCanvas, type CutoutProps } from './cutout.ts';
import { CutoutLayer } from './CutoutLayer.tsx';

/** Width of the sticker outline, px. */
const OUTLINE_PX = 5;

/** The stacked drop-shadows of the sticker outline. */
export const STICKER_FILTER = [
  `${String(OUTLINE_PX)}px 0`,
  `-${String(OUTLINE_PX)}px 0`,
  `0 ${String(OUTLINE_PX)}px`,
  `0 -${String(OUTLINE_PX)}px`,
]
  .map((offset) => `drop-shadow(${offset} 0 #ffffff)`)
  .join(' ');

/**
 * Draws a cut-out from its props. Nothing paints the background, so the PNG is transparent.
 * @param props - Validated `CutoutProps`.
 * @returns The still.
 */
export function Cutout({ sticker, ...source }: CutoutProps) {
  const { placement } = cutoutCanvas(source.box, sticker);
  return (
    <AbsoluteFill style={sticker ? { filter: STICKER_FILTER } : {}}>
      <CutoutLayer source={source} placement={placement} />
    </AbsoluteFill>
  );
}
