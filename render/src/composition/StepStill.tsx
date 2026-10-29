// The StepStill composition: a guide step's frame, full size, with a yellow ring drawn along the
// circled control's outline over a dark halo. No text is baked in.
import { AbsoluteFill, Img } from 'remotion';
import { HALO_COLOR, RING_COLOR, ringWidth, type StepStillProps } from './step.ts';

/**
 * Draws one guide step still from its props.
 * @param props - Validated `StepStillProps`.
 * @returns The still.
 */
export function StepStill({ image_url, width, height, outline }: StepStillProps) {
  const ring = ringWidth(width, height);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      <Img src={image_url} style={{ width: '100%', height: '100%', objectFit: 'fill' }} />
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        width={width}
        height={height}
        style={{ position: 'absolute', inset: 0 }}
      >
        <path d={outline} fill="none" stroke={HALO_COLOR} strokeWidth={ring * 2} strokeLinejoin="round" />
        <path d={outline} fill="none" stroke={RING_COLOR} strokeWidth={ring} strokeLinejoin="round" />
      </svg>
    </AbsoluteFill>
  );
}
