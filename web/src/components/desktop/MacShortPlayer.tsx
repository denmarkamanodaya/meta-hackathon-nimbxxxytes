// The Mac Short page's player (redesign v2, V7): the draft in the Remotion Player at 380 px with
// its "v1 · 0:10" badge, then compact controls: a scrubber with a mark at each cut between shots,
// play, the time, loop and full screen. Before the draft has composition props it falls back to
// the server preview (or "Making the first cut…") without the controls.
import type { PlayerRef } from '@remotion/player';
import { useEffect, useState, type PointerEvent, type RefObject } from 'react';
import { totalFrames, type ShortProps } from '@nimbytes/composition';
import { formatDuration } from '../../core/format';
import { cutPercents } from '../../core/nle-shots';
import { previewBadge } from '../../core/studio';
import { scrubSeconds } from '../../core/timeline';
import { Icon } from '../../design/Icon';
import type { ShortVersion } from '../../services/api/types';
import { ShortPlayer } from '../ShortPlayer';
import { ShortPreview } from '../ShortPreview';
import { PlayerGlyph } from './PlayerGlyphs';
import './MacShortPlayer.css';

/** Props for `MacShortPlayer`. */
export interface MacShortPlayerProps {
  version: ShortVersion;
  playerProps: ShortProps | null;
  /** The draft's length, seconds (the badge). */
  lengthS: number;
  isWorking: boolean;
  /** "from disk" once the shots read synced proxies. */
  badgeSuffix?: string;
  /** Shot starts on the output timeline, seconds (the cut marks). */
  starts: readonly number[];
  /** The page's handle on the Player, so a timeline row can seek it. */
  playerRef: RefObject<PlayerRef | null>;
}

const pct = (value: number) => `${String(value)}%`;

interface ControlsProps {
  playerProps: ShortProps;
  starts: readonly number[];
  playerRef: RefObject<PlayerRef | null>;
  isLooping: boolean;
  onLoop: () => void;
}

function Controls({ playerProps, starts, playerRef, isLooping, onLoop }: ControlsProps) {
  const [frame, setFrame] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [isDragging, setDragging] = useState(false);
  const fps = playerProps.fps;
  const total = totalFrames(playerProps);
  const totalS = total / fps;
  const played = Math.min(100, (frame / Math.max(1, total - 1)) * 100);

  // Follows the Player: its frame as it plays or seeks, and whether it plays.
  useEffect(() => {
    const player = playerRef.current;
    if (player === null) return undefined;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      setFrame(detail.frame);
    };
    const onPlay = () => {
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
    };
    player.addEventListener('frameupdate', onFrame);
    player.addEventListener('seeked', onFrame);
    player.addEventListener('play', onPlay);
    player.addEventListener('pause', onPause);
    player.addEventListener('ended', onPause);
    return () => {
      player.removeEventListener('frameupdate', onFrame);
      player.removeEventListener('seeked', onFrame);
      player.removeEventListener('play', onPlay);
      player.removeEventListener('pause', onPause);
      player.removeEventListener('ended', onPause);
    };
  }, [playerRef]);

  const seekAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = Math.min(total - 1, Math.round(scrubSeconds(event.clientX - rect.left, rect.width, totalS) * fps));
    playerRef.current?.seekTo(next);
    setFrame(next);
  };

  return (
    <div className="mac-short-player__bar">
      <div
        className="mac-short-player__scrub"
        role="slider"
        tabIndex={-1}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalS)}
        aria-valuenow={Math.round(frame / fps)}
        aria-valuetext={formatDuration(frame / fps)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          seekAt(event);
        }}
        onPointerMove={(event) => {
          if (isDragging) seekAt(event);
        }}
        onPointerUp={() => {
          setDragging(false);
        }}
      >
        <span className="mac-short-player__track" />
        <span className="mac-short-player__played" style={{ width: pct(played) }} />
        {cutPercents(starts, totalS).map((left) => (
          <span key={left} className="mac-short-player__cut" style={{ left: pct(left) }} />
        ))}
        <span className="mac-short-player__head" style={{ left: pct(played) }} />
      </div>
      <div className="mac-short-player__controls">
        <button
          type="button"
          className="mac-short-player__play"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          onClick={() => {
            playerRef.current?.toggle();
          }}
        >
          <Icon name={isPlaying ? 'pause' : 'play'} size="xs" />
        </button>
        <span className="mac-short-player__time">
          {formatDuration(frame / fps)} <span className="mac-short-player__total">{`/ ${formatDuration(totalS)}`}</span>
        </span>
        <span className="mac-columns__grow" />
        <button
          type="button"
          className={isLooping ? 'mac-short-player__button mac-short-player__button--on' : 'mac-short-player__button'}
          aria-label="Loop"
          aria-pressed={isLooping}
          onClick={onLoop}
        >
          <PlayerGlyph name="loop" />
        </button>
        <button
          type="button"
          className="mac-short-player__button"
          aria-label="Full screen"
          onClick={() => {
            playerRef.current?.requestFullscreen();
          }}
        >
          <PlayerGlyph name="fullscreen" />
        </button>
      </div>
    </div>
  );
}

/**
 * The player.
 * @param props - See `MacShortPlayerProps`.
 * @returns The player block.
 */
export function MacShortPlayer({ version, playerProps, lengthS, isWorking, badgeSuffix, starts, playerRef }: MacShortPlayerProps) {
  const [isLooping, setLooping] = useState(false);
  const aspectClass = `mac-short-player--${version.timeline.aspect === '1:1' ? 'square' : 'portrait'}`;
  if (playerProps === null) {
    return (
      <div className={`mac-short-player mac-short-player--fallback ${aspectClass}`}>
        <ShortPreview version={version} playerProps={null} lengthS={lengthS} isWorking={isWorking} />
      </div>
    );
  }
  return (
    <div className={`mac-short-player ${aspectClass}`}>
      <div className="mac-short-player__stage">
        <ShortPlayer props={playerProps} playerRef={playerRef} hasControls={false} isLooping={isLooping} />
        <span className="short-preview__badge">{previewBadge(version.n, lengthS, badgeSuffix)}</span>
      </div>
      <Controls
        playerProps={playerProps}
        starts={starts}
        playerRef={playerRef}
        isLooping={isLooping}
        onLoop={() => {
          setLooping(!isLooping);
        }}
      />
    </div>
  );
}
