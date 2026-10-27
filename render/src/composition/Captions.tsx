// Animated phrase captions: the phrase pops in white, and the word being said turns the accent colour.
// Timing is phrase-level from the transcript; word times inside a phrase are estimates.
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { activeCaption, activeWordIndex, toFrames } from '../frames.ts';
import type { FrameAspect, ShortClip } from './schema.ts';
import { CAPTION_BOTTOM, CAPTION_SHADOW, CAPTION_SIZE, captionWordPaint } from './style.ts';

/** Props for `Captions`. */
export interface CaptionsProps {
  clip: ShortClip;
  aspect: FrameAspect;
  accent: string;
  font: string;
}

/**
 * Captions for one shot, read in source time (`in_s` + frames into the shot).
 * @param props - See `CaptionsProps`.
 * @returns The caption layer, empty between phrases.
 */
export function Captions({ clip, aspect, accent, font }: CaptionsProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sourceS = clip.in_s + frame / fps;
  const caption = activeCaption(clip.captions, sourceS);
  if (caption === null) return null;

  // Frames since the phrase appeared in this shot (a phrase may start before the in point).
  const shown = frame - Math.max(0, toFrames(caption.start_s - clip.in_s, fps));
  const pop = spring({ frame: shown, fps, config: { damping: 14, stiffness: 180, mass: 0.6 } });
  const active = activeWordIndex(caption, sourceS);
  const words = caption.words.length > 0 ? caption.words.map((w) => w.text) : [caption.text];

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: CAPTION_BOTTOM[aspect] }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '6px 14px',
          maxWidth: '86%',
          fontFamily: font,
          fontSize: CAPTION_SIZE[aspect],
          fontWeight: 800,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          opacity: interpolate(shown, [0, 3], [0, 1], { extrapolateRight: 'clamp' }),
          scale: interpolate(pop, [0, 1], [0.82, 1]),
          translate: `0px ${String(interpolate(pop, [0, 1], [24, 0]))}px`,
        }}
      >
        {words.map((word, index) => {
          const isActive = index === active;
          const paint = captionWordPaint(isActive, accent);
          return (
            <span
              key={`${String(index)}-${word}`}
              style={{
                color: paint.color,
                WebkitTextStroke: paint.stroke,
                paintOrder: 'stroke fill',
                textShadow: CAPTION_SHADOW,
                scale: isActive
                  ? interpolate(frame % 6, [0, 2, 6], [1.04, 1.08, 1.06], { easing: Easing.bezier(0.33, 1, 0.68, 1) })
                  : 1,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}
