// The NimbytesShort composition: shots end to end, each with its captions, a soft bottom
// gradient for legibility, and an optional end card. The Player in the PWA and the renderer
// both draw this component, so the preview is the final.
import type { ReactNode } from 'react';
import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion';
import { clipTimings, dimensions, stageScale, toFrames } from '../frames.ts';
import { Captions } from './Captions.tsx';
import { ClipLayer } from './ClipLayer.tsx';
import { EndCard } from './EndCard.tsx';
import type { ShortProps } from './schema.ts';

/**
 * Lays the content out at 1080 wide and scales it to the rendered size, so the 544-wide preview
 * and the 1080-wide final are the same picture (renderMedia's own `scale` would round to odd
 * heights). Pixel values in the composition are all at 1080 wide.
 */
function Stage({ aspect, children }: { aspect: ShortProps['aspect']; children: ReactNode }) {
  const { width } = useVideoConfig();
  const base = dimensions(aspect);
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      <div style={{ position: 'absolute', width: base.width, height: base.height, transformOrigin: '0 0', scale: String(stageScale(width)) }}>
        {children}
      </div>
    </AbsoluteFill>
  );
}

/**
 * Draws a short from its props.
 * @param props - Validated `ShortProps`.
 * @returns The composition tree.
 */
export function NimbytesShort(props: ShortProps) {
  const { clips, fps, theme, aspect } = props;
  const timings = clipTimings(clips, fps);
  const endFrom = timings.reduce((sum, t) => sum + t.durationInFrames, 0);
  return (
    <Stage aspect={aspect}>
      {clips.map((clip, index) => {
        const timing = timings[index];
        if (timing === undefined) return null;
        return (
          <Sequence
            key={`${clip.segment_id}-${String(index)}`}
            name={clip.subject ?? `Shot ${String(index + 1)}`}
            from={timing.from}
            durationInFrames={timing.durationInFrames}
          >
            <ClipLayer clip={clip} trimBefore={timing.trimBefore} durationInFrames={timing.durationInFrames} accent={theme.accent} />
            <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.5) 100%)' }} />
            <Captions clip={clip} aspect={aspect} accent={theme.accent} font={theme.font} />
          </Sequence>
        );
      })}
      {props.end_card_s > 0 && (
        <Sequence name="End card" from={endFrom} durationInFrames={toFrames(props.end_card_s, fps)}>
          <EndCard post={props.post} theme={theme} />
        </Sequence>
      )}
    </Stage>
  );
}
