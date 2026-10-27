// Closing card: the post caption, its hashtags, and the nimbytes mark with its name, on the accent.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { LOGO_VIDEO_COLOURS, LogoMark } from './LogoMark.tsx';
import type { ShortProps } from './schema.ts';

/** Props for `EndCard`. */
export interface EndCardProps {
  post: ShortProps['post'];
  theme: ShortProps['theme'];
}

/**
 * The end card.
 * @param props - See `EndCardProps`.
 * @returns The card.
 */
export function EndCard({ post, theme }: EndCardProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 18 } });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(120% 90% at 50% 20%, ${theme.accent} 0%, #0b1117 70%)`,
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: theme.font,
        color: '#ffffff',
        padding: 96,
        textAlign: 'center',
      }}
    >
      {/* Ink, not white: white on the yellow accent is 3.1–3.95:1; ink is 5.4–5.7:1 at the top
          line and 4.45:1 mid-card (large-text AA). Hashtags and the mark stay white. */}
      <div
        style={{
          color: '#0D1B1E',
          fontSize: 84,
          fontWeight: 800,
          letterSpacing: '-0.02em',
          lineHeight: 1.08,
          opacity: enter,
          translate: `0px ${String(interpolate(enter, [0, 1], [40, 0]))}px`,
        }}
      >
        {post.caption}
      </div>
      {post.hashtags.length > 0 && (
        <div style={{ marginTop: 32, fontSize: 40, fontWeight: 600, opacity: interpolate(frame, [6, 14], [0, 0.9], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          {post.hashtags.join('  ')}
        </div>
      )}
      {/* The mark carries its own teal tile, so it reads on any accent. The name stays
          white: the card fades from the accent to #0b1117, and the bottom edge is that dark. */}
      <div
        style={{
          position: 'absolute',
          bottom: 72,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          color: '#ffffff',
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: '-0.01em',
        }}
      >
        <LogoMark size={64} {...LOGO_VIDEO_COLOURS} />
        nimbytes
      </div>
    </AbsoluteFill>
  );
}
