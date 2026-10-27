// The player page's Speech list (redesign v2, V3), shown in the clip panel's Speech tab: it
// follows playback (the line playing now has its time in the accent, its words bold, and "Use in
// short" and "Copy" under it), and a click on a line jumps the player there.
import { useEffect, useRef } from 'react';
import { activeIndex } from '../../core/timeline';
import { formatDuration } from '../../core/format';
import type { Speaker, Turn } from '../../services/api/types';
import './PlayerSpeech.css';

/** Props for `PlayerSpeech`. */
export interface PlayerSpeechProps {
  turns: readonly Turn[];
  speakers: readonly Speaker[];
  /** Playback time, seconds. */
  currentTime: number;
  onSeek: (seconds: number) => void;
  /** "Use in short": hand this line's moment to the editor. */
  onUse: (turn: Turn) => void;
  onCopy: (text: string) => void;
}

/**
 * The list.
 * @param props - See `PlayerSpeechProps`.
 * @returns The list, or a line saying nobody speaks.
 */
export function PlayerSpeech({ turns, speakers, currentTime, onSeek, onUse, onCopy }: PlayerSpeechProps) {
  const nowIndex = activeIndex(turns, currentTime);
  const nowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    nowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [nowIndex]);
  if (turns.length === 0) return <p className="player-speech__empty">Nobody speaks in this clip.</p>;
  return (
    <div className="player-speech">
      <div className="player-speech__top">
        <span>Follows playback · click a line to jump</span>
        <span>{`${String(speakers.length)} ${speakers.length === 1 ? 'speaker' : 'speakers'}`}</span>
      </div>
      <ul className="player-speech__lines">
        {turns.map((turn, index) => {
          const isNow = index === nowIndex;
          return (
            <li key={turn.turn_id} ref={isNow ? nowRef : undefined} className={isNow ? 'player-speech__item player-speech__item--now' : 'player-speech__item'}>
              <button
                type="button"
                className="player-speech__line"
                aria-current={isNow ? 'true' : undefined}
                onClick={() => {
                  onSeek(turn.start_s);
                }}
              >
                <span className="player-speech__time">{formatDuration(turn.start_s)}</span>
                <span className="player-speech__text">{turn.text}</span>
              </button>
              {isNow && (
                <span className="player-speech__actions">
                  <button
                    type="button"
                    className="player-speech__action"
                    onClick={() => {
                      onUse(turn);
                    }}
                  >
                    Use in short
                  </button>
                  <button
                    type="button"
                    className="player-speech__action player-speech__action--quiet"
                    onClick={() => {
                      onCopy(turn.text);
                    }}
                  >
                    Copy
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
