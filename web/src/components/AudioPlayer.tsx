// The recording player (mock GalleryMixedMock frame 1): a wave lit up to where it plays (a tap on
// a bar jumps there), the round play/pause button, "0:37 / 1:30" and the file's name. The page owns
// the player state (`useAudioPlayer`) so What was said can seek it and follow it.
import { waveHeights } from '../core/ask/voice';
import { litBars, playerTime } from '../core/ilisten/player';
import { Icon } from '../design/Icon';
import type { AudioPlayer as Player } from '../hooks/useAudioPlayer';
import './AudioPlayer.css';

/** Bars in the wave. */
const BARS = 40;
/** Their heights, px. */
const HEIGHTS = waveHeights(BARS, 10, 44);

/** Props for `AudioPlayer`. */
export interface AudioPlayerProps {
  src: string;
  /** The file's name, shown on the right. */
  name: string;
  player: Player;
}

/**
 * The player.
 * @param props - See `AudioPlayerProps`.
 * @returns The player with its hidden <audio>.
 */
export function AudioPlayer({ src, name, player }: AudioPlayerProps) {
  const { ref, isPlaying, atS, lengthS, toggle, seek, events } = player;
  const lit = litBars(BARS, atS, lengthS);
  return (
    <div className="audio-player">
      <audio ref={ref} src={src} preload="metadata" {...events} />
      <div className="audio-player__wave">
        {HEIGHTS.map((height, index) => (
          <button
            key={index}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={index < lit ? 'audio-player__bar audio-player__bar--past' : 'audio-player__bar'}
            style={{ height: `${String(height)}px` }}
            onClick={() => {
              seek((index / BARS) * lengthS);
            }}
          />
        ))}
      </div>
      <div className="audio-player__controls">
        <button type="button" className="audio-player__play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={toggle}>
          <Icon name={isPlaying ? 'pause' : 'play'} size="sm" />
        </button>
        <span className="audio-player__time">{playerTime(atS, lengthS)}</span>
        <span className="audio-player__name">{name}</span>
      </div>
    </div>
  );
}
