// Props and layout of a SAM cut-out: a subject outlined by an SVG path in frame pixels, drawn
// from the frame picture. The Cutout still (a transparent PNG cropped to the subject's box) and
// the CoverStill cutout layer both draw it. Mask decoding happens in the renderer server, never
// here, so the PWA Player that imports the composition does not carry the mask decoder.
import { z } from 'zod';

const pixel = z.int().nonnegative();

/** A SAM box in frame pixels. `x2` and `y2` are inclusive, as SAM reports them. */
export const BoxSchema = z
  .object({ x1: pixel, y1: pixel, x2: pixel, y2: pixel })
  .refine((box) => box.x2 >= box.x1 && box.y2 >= box.y1, { message: 'x2/y2 must not be before x1/y1' });

/** Size of the frame the box and the path are measured on, px. */
export const FrameSizeSchema = z.object({ w: z.int().positive(), h: z.int().positive() });

/** One cut-out subject: the frame picture, its size, the outline in frame pixels and the box. */
export const CutoutSourceSchema = z
  .object({
    /** Presigned URL of the frame picture. */
    image_url: z.string().min(1),
    frame: FrameSizeSchema,
    /** SVG path data in frame pixels (M, L and Z only); also guards the CSS it is placed in. */
    path: z.string().regex(/^[MLZ\d.\- ]+$/, { message: 'path must be M/L/Z path data' }),
    box: BoxSchema,
  })
  .refine((s) => s.box.x2 < s.frame.w && s.box.y2 < s.frame.h, { message: 'box must lie inside the frame' });

/** Props of the Cutout still. */
export const CutoutPropsSchema = CutoutSourceSchema.safeExtend({
  /** Sticker look: padding and a white outline. */
  sticker: z.boolean(),
});

/** A SAM box. */
export type Box = z.infer<typeof BoxSchema>;
/** A frame size. */
export type FrameSize = z.infer<typeof FrameSizeSchema>;
/** One cut-out subject. */
export type CutoutSource = z.infer<typeof CutoutSourceSchema>;
/** Props of Cutout. */
export type CutoutProps = z.infer<typeof CutoutPropsSchema>;

/** Room around a sticker for its white outline, px on each side. */
export const STICKER_PAD = 12;

/**
 * Size of a box in pixels (its corners are inclusive: x1 16, x2 239 is 224 px wide).
 * @param box - A SAM box.
 * @returns Width and height, px.
 */
export function boxSize(box: Box): { width: number; height: number } {
  return { width: box.x2 - box.x1 + 1, height: box.y2 - box.y1 + 1 };
}

/** Where a cut-out is drawn: the box's top-left corner in output pixels, and its scale. */
export interface CutoutPlacement {
  left: number;
  top: number;
  scale: number;
}

/**
 * Canvas of the Cutout still: the box, plus the sticker padding on every side.
 * @param box - The subject's box.
 * @param sticker - Whether the sticker outline is drawn.
 * @returns The output size and where the box sits in it.
 */
export function cutoutCanvas(box: Box, sticker: boolean): { width: number; height: number; placement: CutoutPlacement } {
  const pad = sticker ? STICKER_PAD : 0;
  const size = boxSize(box);
  return { width: size.width + 2 * pad, height: size.height + 2 * pad, placement: { left: pad, top: pad, scale: 1 } };
}

/** Share of the cover height the subject's box fills. */
export const SUBJECT_HEIGHT_SHARE = 0.64;

/**
 * Where the subject goes on a cover: bottom-centre, scaled so its box is 64 % of the cover
 * height, or smaller when that would make it wider than the cover.
 * @param box - The subject's box.
 * @param cover - Cover size, px.
 * @returns The placement of the box.
 */
export function cutoutPlacement(box: Box, cover: { width: number; height: number }): CutoutPlacement {
  const size = boxSize(box);
  const scale = Math.min((cover.height * SUBJECT_HEIGHT_SHARE) / size.height, cover.width / size.width);
  return { left: (cover.width - size.width * scale) / 2, top: cover.height - size.height * scale, scale };
}
