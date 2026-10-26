// Closing card: the post caption, its hashtags, and a small nimbytes mark, on the accent.
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
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
      <div
        style={{
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
      <div style={{ position: 'absolute', bottom: 72, fontSize: 30, fontWeight: 700, letterSpacing: '0.08em', opacity: 0.7 }}>
        nimbytes
      </div>
    </AbsoluteFill>
  );
}
