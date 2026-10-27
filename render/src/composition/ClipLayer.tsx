// One shot: the source video trimmed to its in point, cover-cropped to the frame, with the
// punch-in zoom and a slow push so even a still moment feels alive. Without a source URL it
// draws a gradient placeholder carrying the subject (mock mode, missing proxy). Hidden faces are
// blurred inside the same zoomed layer.
import { AbsoluteFill, interpolate, OffthreadVideo, useCurrentFrame } from 'remotion';
import { FaceBlur } from './FaceBlur.tsx';
import type { Blur, ShortClip } from './schema.ts';
import { CAPTION_FILL } from './style.ts';

/** Props for `ClipLayer`. */
export interface ClipLayerProps {
  clip: ShortClip;
  /** Name shown on the placeholder: subject or "Shot N". */
  label: string;
  /** Source frames to skip (the clip's in point). */
  trimBefore: number;
  durationInFrames: number;
  accent: string;
  /** Hidden faces of this clip's segment. */
  faces: readonly Blur[];
  /** The layer's size at 1080 wide. */
  layer: { width: number; height: number };
}

function Placeholder({ label, accent }: Pick<ClipLayerProps, 'label' | 'accent'>) {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${accent} 0%, #0b1117 85%)`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Opaque white: 75% white measured 3.97:1 on this background, opaque is 5.6:1. */}
      <div style={{ color: CAPTION_FILL, fontSize: 54, fontWeight: 700, padding: 80, textAlign: 'center' }}>
        {label}
      </div>
    </AbsoluteFill>
  );
}

/**
 * Draws one shot inside its Sequence.
 * @param props - See `ClipLayerProps`.
 * @returns The layer.
 */
export function ClipLayer({ clip, label, trimBefore, durationInFrames, accent, faces, layer }: ClipLayerProps) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        overflow: 'hidden',
        scale: clip.punch_in * interpolate(frame, [0, durationInFrames], [1, 1.04], { extrapolateRight: 'clamp' }),
      }}
    >
      {clip.src_url === null ? (
        <Placeholder label={label} accent={accent} />
      ) : (
        <OffthreadVideo
          src={clip.src_url}
          trimBefore={trimBefore}
          durationInFrames={durationInFrames}
          muted={false}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
      {faces.length > 0 && (
        <FaceBlur clip={clip} faces={faces} trimBefore={trimBefore} durationInFrames={durationInFrames} frame={layer} />
      )}
    </AbsoluteFill>
  );
}
