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
export { COMPOSITION_ID } from './id.ts';
