// The Remotion Player showing a version exactly as the renderer will draw it: the same
// NimbytesShort composition, fed with the version's props (or the edited draft's).
import { Player, type PlayerRef } from '@remotion/player';
import type { RefObject } from 'react';
import { NimbytesShort, dimensions, totalFrames, type ShortProps } from '@nimbytes/composition';
import './ShortPlayer.css';

/** Props for `ShortPlayer`. */
export interface ShortPlayerProps {
  props: ShortProps;
  /** Handle for seeking (critique notes, deep links). */
  playerRef: RefObject<PlayerRef | null>;
  /** First frame to show, for a deep link into the preview. */
  initialFrame?: number;
}

/**
 * Player sized to the short's aspect, with play, time and fullscreen (no volume: the 176 px
 * preview has no room); edits to `props` show at once.
 * @param props - See `ShortPlayerProps`.
 * @returns The player.
 */
export function ShortPlayer({ props, playerRef, initialFrame }: ShortPlayerProps) {
  const size = dimensions(props.aspect);
  const duration = totalFrames(props);
  return (
    <Player
      ref={playerRef}
      className="short-player"
      component={NimbytesShort}
      inputProps={props}
      durationInFrames={duration}
      compositionWidth={size.width}
      compositionHeight={size.height}
      fps={props.fps}
      controls
      clickToPlay
      allowFullscreen
      showVolumeControls={false}
      acknowledgeRemotionLicense
      initialFrame={Math.min(initialFrame ?? 0, duration - 1)}
      style={{ width: '100%', aspectRatio: `${String(size.width)} / ${String(size.height)}` }}
    />
  );
}
