// SAM masks to outlines in frame pixels. A SAM 3.1 mask is a base85 range-coded raster covering
// the record's box, not the frame; the official parser decodes it to SVG path data in raster
// coordinates, and this module moves that path onto the frame. The renderer is the only place
// that decodes masks.
import { decodeMaskToSVGPath } from '@meta-sam/parser';
import { z } from 'zod';
import { boxSize, type Box } from './composition/cutout.ts';

/** A complete SAM mask exactly as the API emitted it; `payload` keeps its `!` / `~` prefix. */
export const MaskSchema = z.object({
  encoding: z.enum(['one_bit', 'lossless']),
  width: z.int().positive(),
  height: z.int().positive(),
  payload: z.string().min(1),
});

/** A SAM mask. */
export type Mask = z.infer<typeof MaskSchema>;

/**
 * Whether the mask's raster is exactly the box (SAM sends `data=H,W` for an inclusive box).
 * @param mask - The mask.
 * @param box - Its record's box.
 * @returns True when the sizes match.
 */
export function maskFitsBox(mask: Mask, box: Box): boolean {
  const size = boxSize(box);
  return mask.width === size.width && mask.height === size.height;
}

/** One `M x y`, `L x y` or `Z` command, the only ones the parser's contour tracer writes. */
const COMMAND = /([ML])(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)|Z/g;

/**
 * Moves SVG path data by (dx, dy).
 * @param path - Path data made of `M x y`, `L x y` and `Z` commands.
 * @param dx - Added to every x.
 * @param dy - Added to every y.
 * @returns The moved path, in the same form.
 * @throws Error when the path holds anything else.
 */
export function translatePath(path: string, dx: number, dy: number): string {
  if (path.replace(COMMAND, '') !== '') throw new Error('Path holds commands other than M, L and Z');
  return path.replace(COMMAND, (whole, command: string | undefined, x: string | undefined, y: string | undefined) =>
    command === undefined ? whole : `${command}${String(Number(x) + dx)} ${String(Number(y) + dy)}`,
  );
}

/** The decoded outline, or why the mask could not be decoded. */
export type FramePath = { ok: true; path: string } | { ok: false; message: string };

/**
 * A mask's outline in frame pixels. The tracer puts raster pixel centres on whole numbers, so
 * raster pixel (c, r), which is frame pixel (x1 + c, y1 + r), has its centre at
 * (x1 + c + 0.5, y1 + r + 0.5): the path moves by the box corner plus half a pixel and then runs
 * along the frame's pixel edges.
 * @param mask - The SAM mask.
 * @param box - Its record's box, frame pixels.
 * @returns The path, or a message for a mask that does not fit the box or does not decode.
 */
export function maskToFramePath(mask: Mask, box: Box): FramePath {
  if (!maskFitsBox(mask, box)) {
    return { ok: false, message: `mask is ${String(mask.width)}x${String(mask.height)}, the box is not` };
  }
  try {
    return { ok: true, path: translatePath(decodeMaskToSVGPath(mask), box.x1 + 0.5, box.y1 + 0.5) };
  } catch (thrown) {
    return { ok: false, message: thrown instanceof Error ? thrown.message : 'mask does not decode' };
  }
}
