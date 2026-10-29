// The answer card's voice bar (V48): a round Play / Pause, a wave that fills as the voice goes,
// the time ("0:09 / 0:21") and which voice it is. The device voice has no clock: while it speaks
// the whole wave moves and no time shows. With no voice, the bar gives way to the
// "Voice not available right now" line.
import { waveHeights } from '../core/ask/voice';
import { formatDuration } from '../core/format';
import { IREAD_COPY } from '../core/iread/documents';
import { Icon } from '../design/Icon';
import { useNow } from '../hooks/useNow';
import type { ReadAloud } from '../hooks/useReadAloud';
import './ReadAloudBar.css';

/** Bars in the wave and their heights, px (the mock's 48 bars, 8–26 px). */
const WAVE = waveHeights(48, 8, 18);

/** How often the bar redraws while the voice plays, ms. */
const TICK_MS = 250;

/** Props for `ReadAloudBar`. */
export interface ReadAloudBarProps {
  player: ReadAloud;
  /** What Play starts when nothing is held (the answer again). */
  onPlay: () => void;
  /** False when there is no voice to play. */
  hasVoice: boolean;
}

function Progress({ player }: { player: ReadAloud }) {
  useNow(TICK_MS);
  const position = player.position();
  const at = position?.atS ?? 0;
  const length = position?.lengthS ?? 0;
  const isUntimed = position === null && player.status !== 'idle';
  const share = isUntimed ? 1 : length > 0 ? Math.min(1, at / length) : 0;
  const lit = Math.round(share * WAVE.length);
  const isMoving = player.status === 'playing';
  return (
    <>
      <span className="read-bar__wave" aria-hidden="true">
        {WAVE.map((height, index) => (
          <span
            key={index}
            className={`read-bar__wave-bar${index < lit ? ' read-bar__wave-bar--lit' : ''}${isMoving && index < lit ? ' read-bar__wave-bar--moving' : ''}`}
            style={{ height: `${String(height)}px`, animationDelay: `${String((index % 6) * 120)}ms` }}
          />
        ))}
      </span>
      {!isUntimed && <span className="read-bar__time">{length > 0 ? `${formatDuration(at)} / ${formatDuration(length)}` : formatDuration(at)}</span>}
    </>
  );
}

/**
 * The bar.
 * @param props - See `ReadAloudBarProps`.
 * @returns The bar, or the no-voice line.
 */
export function ReadAloudBar({ player, onPlay, hasVoice }: ReadAloudBarProps) {
  if (!hasVoice || (player.status === 'idle' && player.message !== null)) {
    return (
      <p className="read-bar__none" role="status">
        {player.message ?? IREAD_COPY.noVoice}
      </p>
    );
  }
  const isPlaying = player.status === 'playing' || player.status === 'loading';
  const toggle = () => {
    if (player.status === 'playing') player.pause();
    else if (player.status === 'paused') player.resume();
    else if (player.status === 'idle') onPlay();
  };
  return (
    <div className="read-bar">
      <button type="button" className="read-bar__play" aria-label={isPlaying ? IREAD_COPY.pause : IREAD_COPY.play} onClick={toggle}>
        <Icon name={isPlaying ? 'pause' : 'play'} size="md" />
      </button>
      <Progress player={player} />
      <span className="read-bar__voice">{IREAD_COPY.voiceLabel}</span>
    </div>
  );
}
