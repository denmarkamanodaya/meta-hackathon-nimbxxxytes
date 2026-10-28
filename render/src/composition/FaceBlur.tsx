// Blurs the faces the owner hid in People: one soft ellipse per face, following its 1 fps boxes
// (interpolated), padded, and mapped through the clip's cover crop (the same framing as the
// shot). It is drawn inside the clip's zoomed layer, so the punch-in and the slow push move it
// with the picture.
//
// Each face is a blurred copy of the same video clipped to an ellipse. Measured against a
// `backdrop-filter` overlay on a 20 s 4:5 render: about the same time for previews and +28 % for
// finals, but `backdrop-filter` drew dark, tinted discs in headless Chromium, so the copy is used.
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { boxAt, coverRect, padBox } from '../blur.ts';
import { videoBox, type Framing, type PixelRect } from '../crop.ts';
import type { Blur, ShortClip } from './schema.ts';

/** Blur radius at 1080 wide. */
const BLUR_PX = 24;

/** Props for `FaceBlur`. */
export interface FaceBlurProps {
  clip: ShortClip;
  /** The hidden faces of this clip's segment. */
  faces: readonly Blur[];
  /** Source frames skipped before the clip starts (its `in`). */
  trimBefore: number;
  durationInFrames: number;
  /** The layer's size at 1080 wide. */
  frame: { width: number; height: number };
  /** The shot's framing now when it follows its subject; null for the centred crop. */
  framing: Framing | null;
}

function ellipse(r: PixelRect): string {
  return `ellipse(${String(r.width / 2)}px ${String(r.height / 2)}px at ${String(r.left + r.width / 2)}px ${String(r.top + r.height / 2)}px)`;
}

/**
 * Draws the blurred faces for the current frame of one shot.
 * @param props - See `FaceBlurProps`.
 * @returns The overlay, or null when no face shows now.
 */
export function FaceBlur({ clip, faces, trimBefore, durationInFrames, frame, framing }: FaceBlurProps) {
  const current = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = clip.in_s + current / fps;
  const rects = faces.flatMap((face) => {
    const at = boxAt(face.boxes, t);
    return at === null ? [] : [coverRect(padBox(at, face.aspect), face.aspect, frame, framing?.centre)];
  });
  const src = clip.src_url;
  if (rects.length === 0 || src === null) return null;
  return (
    <>
      {rects.map((r, i) => (
        <AbsoluteFill key={i} style={{ clipPath: ellipse(r) }}>
          <OffthreadVideo
            src={src}
            trimBefore={trimBefore}
            durationInFrames={durationInFrames}
            muted
            style={{ ...videoBox(framing), filter: `blur(${String(BLUR_PX)}px)` }}
          />
        </AbsoluteFill>
      ))}
    </>
  );
}
