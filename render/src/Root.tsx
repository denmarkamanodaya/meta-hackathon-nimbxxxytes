// Registers NimbytesShort for the bundler, the renderer and Remotion Studio. Duration and size
// come from the props (calculateMetadata), so one composition serves every frame.
import { Composition, type CalculateMetadataFunction } from 'remotion';
import sample from '../fixtures/props.sample.json';
import { COMPOSITION_ID, NimbytesShort, ShortPropsSchema, dimensions, frameAspect, totalFrames, type ShortProps } from './composition/index.ts';

const calculateMetadata: CalculateMetadataFunction<ShortProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
  fps: props.fps,
  ...dimensions(frameAspect(props)),
});

/**
 * The Remotion root.
 * @returns The composition list.
 */
export function RemotionRoot() {
  return (
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
  );
}
