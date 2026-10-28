// Registers NimbytesShort, CoverStill and Cutout for the bundler, the renderer and Remotion Studio.
// Duration and size come from the props (calculateMetadata), so one composition serves every frame.
import { Composition, Still, type CalculateMetadataFunction } from 'remotion';
import coverSample from '../fixtures/cover_still.sample.json';
import cutoutSample from '../fixtures/cutout.sample.json';
import sample from '../fixtures/props.sample.json';
import {
  COMPOSITION_ID,
  COVER_STILL_ID,
  CoverStill,
  CoverStillPropsSchema,
  CUTOUT_ID,
  Cutout,
  CutoutPropsSchema,
  cutoutCanvas,
  NimbytesShort,
  ShortPropsSchema,
  dimensions,
  frameAspect,
  totalFrames,
  type CoverStillProps,
  type CutoutProps,
  type ShortProps,
} from './composition/index.ts';

const calculateMetadata: CalculateMetadataFunction<ShortProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
  fps: props.fps,
  ...dimensions(frameAspect(props)),
});

const coverMetadata: CalculateMetadataFunction<CoverStillProps> = ({ props }) => ({ width: props.width, height: props.height });

const cutoutMetadata: CalculateMetadataFunction<CutoutProps> = ({ props }) => {
  const { width, height } = cutoutCanvas(props.box, props.sticker);
  return { width, height };
};

/**
 * The Remotion root.
 * @returns The composition list.
 */
export function RemotionRoot() {
  return (
    <>
      <Composition
        id={COMPOSITION_ID}
        component={NimbytesShort}
        schema={ShortPropsSchema}
        defaultProps={ShortPropsSchema.parse(sample)}
        calculateMetadata={calculateMetadata}
        durationInFrames={1}
        fps={30}
        width={1080}
        height={1350}
      />
      <Still
        id={COVER_STILL_ID}
        component={CoverStill}
        schema={CoverStillPropsSchema}
        defaultProps={CoverStillPropsSchema.parse(coverSample)}
        calculateMetadata={coverMetadata}
      />
      <Still
        id={CUTOUT_ID}
        component={Cutout}
        schema={CutoutPropsSchema}
        defaultProps={CutoutPropsSchema.parse(cutoutSample)}
        calculateMetadata={cutoutMetadata}
      />
    </>
  );
}
