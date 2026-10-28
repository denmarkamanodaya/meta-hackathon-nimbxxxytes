// Where the picture of a <video> sits inside its element, and the maps between them: a click on
// the element to 0..1 of the frame (Find this, Cut out), and a frame-pixel outline back onto the
// element. `object-fit: contain` letterboxes the picture; `cover` lets it overflow and crops it.

/** How the video element fits its picture (its CSS `object-fit`). */
export type VideoFit = 'contain' | 'cover';

/** A width and a height. */
export interface Size {
  width: number;
  height: number;
}

/** A rectangle: its top-left corner and its size. */
export interface Rect extends Size {
  left: number;
  top: number;
}

/** A point as shares of the frame: 0..1 across, 0..1 down. */
export interface FrameShare {
  x: number;
  y: number;
}

/**
 * The rectangle the picture fills, relative to the element's top-left corner. With `cover` it can
 * be larger than the element (the overflow is cropped). A media size of 0 (metadata not loaded)
 * means the picture fills the element.
 * @param element - The element's size.
 * @param media - The video's own size (`videoWidth`, `videoHeight`).
 * @param fit - The element's `object-fit`.
 * @returns The picture's rectangle.
 */
export function pictureRect(element: Size, media: Size, fit: VideoFit): Rect {
  if (media.width <= 0 || media.height <= 0 || element.width <= 0 || element.height <= 0) {
    return { left: 0, top: 0, width: element.width, height: element.height };
  }
  const scaleX = element.width / media.width;
  const scaleY = element.height / media.height;
  const scale = fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const width = media.width * scale;
  const height = media.height * scale;
  return { left: (element.width - width) / 2, top: (element.height - height) / 2, width, height };
}

/**
 * Maps a click on the video element to the frame.
 * @param client - The click, viewport pixels (`clientX`, `clientY`).
 * @param element - The element's viewport rectangle (`getBoundingClientRect()`).
 * @param media - The video's own size.
 * @param fit - The element's `object-fit`.
 * @returns The point as 0..1 shares of the frame, or null on a letterbox bar (outside the picture).
 */
export function clickToFrame(client: { x: number; y: number }, element: Rect, media: Size, fit: VideoFit): FrameShare | null {
  const picture = pictureRect(element, media, fit);
  if (picture.width <= 0 || picture.height <= 0) return null;
  const x = (client.x - element.left - picture.left) / picture.width;
  const y = (client.y - element.top - picture.top) / picture.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

/**
 * Where to draw an outline given in frame pixels, as percentages of the element, so an SVG with
 * `viewBox="0 0 frameW frameH"` placed there lines up with the picture at any element size.
 * @param element - The element's size.
 * @param media - The video's own size.
 * @param fit - The element's `object-fit`.
 * @returns Left, top, width and height of the picture, in % of the element.
 */
export function pictureBoxPercent(element: Size, media: Size, fit: VideoFit): Rect {
  const picture = pictureRect(element, media, fit);
  if (element.width <= 0 || element.height <= 0) return { left: 0, top: 0, width: 100, height: 100 };
  return {
    left: (picture.left / element.width) * 100,
    top: (picture.top / element.height) * 100,
    width: (picture.width / element.width) * 100,
    height: (picture.height / element.height) * 100,
  };
}

/**
 * A point of the frame in element pixels (where the label chip goes).
 * @param share - The point, 0..1 of the frame.
 * @param element - The element's size.
 * @param media - The video's own size.
 * @param fit - The element's `object-fit`.
 * @returns The point relative to the element's top-left corner.
 */
export function frameToElement(share: FrameShare, element: Size, media: Size, fit: VideoFit): { x: number; y: number } {
  const picture = pictureRect(element, media, fit);
  return { x: picture.left + share.x * picture.width, y: picture.top + share.y * picture.height };
}
