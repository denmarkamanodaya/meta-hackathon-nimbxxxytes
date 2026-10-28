// Props and ring look of the StepStill composition: a MyWay guide step's frame at its own size
// with a ring along the outline of the control the step touches, and no text (the app and the
// share page put the number and words beside it). The wire shape is owned by the Rust step still
// builder (api/crates/core, StepStillProps); both sides test against
// fixtures/step_still.sample.json.
import { z } from 'zod';

/** Everything StepStill needs. */
export const StepStillPropsSchema = z.object({
  /** Presigned URL of the step's frame. */
  image_url: z.string().min(1),
  /** Frame (and output) size, px. */
  width: z.int().positive(),
  height: z.int().positive(),
  /** The control's outline: an SVG path in frame pixels, from `/mask/path`. */
  outline: z.string().min(1),
});

/** Props of StepStill. */
export type StepStillProps = z.infer<typeof StepStillPropsSchema>;

/** The ring colour: a soft yellow that reads on dark and light machines. */
export const RING_COLOR = '#FFE58A';
/** The dark halo under the ring, so it still reads on a white or yellow panel. */
export const HALO_COLOR = 'rgb(0 0 0 / 55%)';

/** Ring width at 720 px of the frame's short side, px. */
const RING_PX_AT_720 = 10;

/**
 * Ring stroke width, scaled with the frame's short side (never under 4 px).
 * @param width - Frame width, px.
 * @param height - Frame height, px.
 * @returns Stroke width, whole px.
 */
export function ringWidth(width: number, height: number): number {
  return Math.max(4, Math.round((RING_PX_AT_720 * Math.min(width, height)) / 720));
}
