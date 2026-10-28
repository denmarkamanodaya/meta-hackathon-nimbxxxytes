// Pure maths of the privacy blur: where a hidden face is at any instant (its 1 fps boxes
// interpolated), how much room the blur takes around it, and where that lands in the frame once
// the clip is cover-cropped (centred, or following its subject). The punch-in zoom needs no maths:
// the blur is drawn inside the clip's zoomed layer.
import type { FaceBox } from './composition/schema.ts';
import { coverPlacement, type Centre, type PixelRect } from './crop.ts';

/** Padding on each side of a face box, as a share of the box's longer side (hair, ears, chin). */
export const BLUR_PAD = 0.3;
/** Two samples further apart than this, seconds, are not bridged: the face was gone between. */
export const MAX_GAP_S = 2;
/** A face is held this long after its last sample, seconds (a sample covers its whole second). */
export const HOLD_S = 1;

/** A box as shares (0–1) of the upright source frame. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * Where a face is at clip second `t`.
 * @param boxes - The face's 1 fps boxes in time order.
 * @param t - Clip seconds.
 * @returns Before the first sample: nothing; between two samples at most `MAX_GAP_S` apart: the
 * linear blend; otherwise the last sample, held for `HOLD_S`; then nothing.
 */
export function boxAt(boxes: readonly FaceBox[], t: number): Rect | null {
  const first = boxes[0];
  if (first === undefined || t < first.t_s) return null;
  for (let i = 0; i < boxes.length; i += 1) {
    const a = boxes[i];
    const b = boxes[i + 1];
    if (a === undefined) break;
    if (b !== undefined && t >= b.t_s) continue;
    if (b !== undefined && b.t_s - a.t_s <= MAX_GAP_S) {
      const k = (t - a.t_s) / (b.t_s - a.t_s);
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k) };
    }
    return t < a.t_s + HOLD_S ? { x: a.x, y: a.y, w: a.w, h: a.h } : null;
  }
  return null;
}

/**
 * Grows a box by `pad` × its longer side on every side, kept inside the frame.
 * @param r - Box as shares of a frame `aspect` (width / height) wide.
 * @param aspect - Width / height of the source frame.
 * @param pad - Share of the longer side added on each side.
 * @returns The padded box, clipped to 0–1.
 */
export function padBox(r: Rect, aspect: number, pad = BLUR_PAD): Rect {
  // The longer side in units of the frame height.
  const long = Math.max(r.w * aspect, r.h);
  const px = (pad * long) / aspect;
  const py = pad * long;
  const x1 = Math.max(0, r.x - px);
  const y1 = Math.max(0, r.y - py);
  const x2 = Math.min(1, r.x + r.w + px);
  const y2 = Math.min(1, r.y + r.h + py);
  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/**
 * Maps a box on the source onto the frame the source is cover-cropped into: centred like CSS
 * `object-fit: cover`, or moved by the shot's crop centre exactly as its video is.
 * @param r - Box as shares of the source.
 * @param aspect - Source width / height.
 * @param frame - Frame size in pixels.
 * @param centre - The shot's crop centre now; centred when absent.
 * @returns The box in frame pixels (may reach outside the frame).
 */
export function coverRect(r: Rect, aspect: number, frame: { width: number; height: number }, centre?: Centre): PixelRect {
  const shown = coverPlacement(aspect, frame, centre);
  return {
    left: shown.left + r.x * shown.width,
    top: shown.top + r.y * shown.height,
    width: r.w * shown.width,
    height: r.h * shown.height,
  };
}
