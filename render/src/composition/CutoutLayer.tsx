// One cut-out subject: the frame picture at frame size, clipped to the subject's outline, scaled
// and moved so the subject's box lands at the placement. Only the subject shows; the rest of the
// output stays as it was underneath (transparent in the Cutout still).
import { Img } from 'remotion';
import type { CutoutPlacement, CutoutSource } from './cutout.ts';

/** Props for `CutoutLayer`. */
export interface CutoutLayerProps {
  source: CutoutSource;
  placement: CutoutPlacement;
}

/**
 * Draws the clipped subject.
 * @param props - See `CutoutLayerProps`.
 * @returns The layer.
 */
export function CutoutLayer({ source, placement }: CutoutLayerProps) {
  const { scale } = placement;
  return (
    <div
      style={{
        position: 'absolute',
        left: placement.left - source.box.x1 * scale,
        top: placement.top - source.box.y1 * scale,
        width: source.frame.w,
        height: source.frame.h,
        transform: `scale(${String(scale)})`,
        transformOrigin: '0 0',
        // The path is in frame pixels, the element's own space before the scale. Even-odd keeps
        // holes in the mask open whichever way the tracer wound them.
        clipPath: `path(evenodd, '${source.path}')`,
      }}
    >
      <Img src={source.image_url} style={{ display: 'block', width: '100%', height: '100%' }} />
    </div>
  );
}
