// Pure maths of the cover crop. A source is scaled to cover the frame (CSS `object-fit: cover`);
// by default it is centred, and with a `crop_path` it is moved so the subject's centre sits at the
// frame centre, clamped so the source always covers the frame. The face blur maps its boxes
// through the same placement, so blur ellipses stay on the faces.
import type { CropKey, ShortClip } from './composition/schema.ts';

/** A rectangle in frame pixels. */
export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A point of the source as shares (0–1) of its width and height. */
export interface Centre {
  cx: number;
  cy: number;
}

/** The middle of the source: the plain centred crop. */
export const CENTRED: Centre = { cx: 0.5, cy: 0.5 };

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/**
 * The crop centre at source second `t`.
 * @param path - Keyframes in time order, at least one.
 * @param t - Source clip seconds.
 * @returns The linear blend of the keyframes around `t`; the first before it starts, the last
 * after it ends.
 */
export function centreAt(path: readonly CropKey[], t: number): Centre {
  let before: CropKey | undefined;
  for (const key of path) {
    if (key.t_s > t) {
      if (before === undefined) return { cx: key.cx, cy: key.cy };
      const k = (t - before.t_s) / (key.t_s - before.t_s);
      return { cx: lerp(before.cx, key.cx, k), cy: lerp(before.cy, key.cy, k) };
    }
    before = key;
  }
  return before === undefined ? CENTRED : { cx: before.cx, cy: before.cy };
}

/** The offset that puts `centre` at the frame's middle, kept between `min` (≤ 0) and 0. */
const clampedOffset = (frame: number, shown: number, centre: number): number =>
  Math.min(0, Math.max(frame - shown, frame / 2 - centre * shown));

/**
 * Where a source lands when it is scaled to cover the frame.
 * @param aspect - Source width / height.
 * @param frame - Frame size in pixels.
 * @param centre - The source point to bring to the frame's middle; centred by default.
 * @returns The source's rectangle in frame pixels; it always covers the whole frame.
 */
export function coverPlacement(aspect: number, frame: { width: number; height: number }, centre: Centre = CENTRED): PixelRect {
  const shown =
    aspect > frame.width / frame.height
      ? { width: frame.height * aspect, height: frame.height }
      : { width: frame.width, height: frame.width / aspect };
  return {
    left: clampedOffset(frame.width, shown.width, centre.cx),
    top: clampedOffset(frame.height, shown.height, centre.cy),
    ...shown,
  };
}

/** How a shot following its subject is drawn at one moment. */
export interface Framing {
  /** The crop centre now. */
  centre: Centre;
  /** The source's rectangle in the layer, px. */
  video: PixelRect;
  /** The subject's point in the layer, px: the punch-in zooms around it. */
  origin: { x: number; y: number };
}

/**
 * The framing of a shot at source second `t`.
 * @param clip - The shot.
 * @param layer - The layer's size, px.
 * @param t - Source clip seconds.
 * @returns The framing, or null for a shot without a `crop_path` (it keeps the centred cover).
 */
export function clipFraming(clip: ShortClip, layer: { width: number; height: number }, t: number): Framing | null {
  if (clip.crop_path === undefined || clip.source_aspect === undefined) return null;
  const centre = centreAt(clip.crop_path, t);
  const video = coverPlacement(clip.source_aspect, layer, centre);
  return {
    centre,
    video,
    origin: { x: video.left + centre.cx * video.width, y: video.top + centre.cy * video.height },
  };
}

/** Size and position of a source video element. */
export type VideoBox =
  | { width: '100%'; height: '100%'; objectFit: 'cover' }
  | { position: 'absolute'; left: number; top: number; width: number; height: number; objectFit: 'cover' };

/**
 * How to size a shot's video: the browser's centred cover, or the framing's rectangle.
 * @param framing - The shot's framing now, or null.
 * @returns Style fields for the video element.
 */
export function videoBox(framing: Framing | null): VideoBox {
  return framing === null
    ? { width: '100%', height: '100%', objectFit: 'cover' }
    : { position: 'absolute', ...framing.video, objectFit: 'cover' };
}
