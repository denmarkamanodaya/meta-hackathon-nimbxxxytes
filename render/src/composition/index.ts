// Public surface of the composition: what the renderer and the PWA Player import
// (`@nimbytes/composition`).
export { NimbytesShort } from './NimbytesShort.tsx';
export { ShortPropsSchema, type ShortProps, type ShortClip, type Caption, type ShortAspect, type FrameAspect } from './schema.ts';
export {
  clipTimings,
  deriveProps,
  dimensions,
  frameAspect,
  outputSize,
  stageScale,
  totalFrames,
  type DraftClip,
  type Quality,
} from '../frames.ts';
export { CoverStill } from './CoverStill.tsx';
export { CoverStillPropsSchema, titleFontSize, titlePlacement, titleWeight, type CoverStillProps, type TitlePosition } from './cover.ts';
export { Cutout } from './Cutout.tsx';
export {
  BoxSchema,
  CutoutPropsSchema,
  CutoutSourceSchema,
  boxSize,
  cutoutCanvas,
  cutoutPlacement,
  type Box,
  type CutoutProps,
  type CutoutSource,
} from './cutout.ts';
export { StepStill } from './StepStill.tsx';
export { RING_COLOR, StepStillPropsSchema, ringWidth, type StepStillProps } from './step.ts';
export { COMPOSITION_ID, COVER_STILL_ID, CUTOUT_ID, STEP_STILL_ID } from './id.ts';
