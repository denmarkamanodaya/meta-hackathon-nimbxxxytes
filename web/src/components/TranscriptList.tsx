// Transcript lines with speaker names; tapping a line seeks the player to it.
import { useMemo } from 'react';
import { speakerName } from '../core/clip-view';
import { formatDuration } from '../core/format';
import type { Speaker, Turn } from '../services/api/types';
import './TranscriptList.css';

/** Props for `TranscriptList`. */
export interface TranscriptListProps {
  turns: readonly Turn[];
  speakers: readonly Speaker[];
  /** Index of the line playing now, or -1. */
  activeIndex: number;
  onSeek: (seconds: number) => void;
}

/**
 * One row per turn: time, speaker, text. The playing line is tinted.
 * @param props - See `TranscriptListProps`.
 * @returns The list.
 */
export function TranscriptList({ turns, speakers, activeIndex, onSeek }: TranscriptListProps) {
  const names = useMemo(
    () => new Map(speakers.map((speaker) => [speaker.speaker_id, speakerName(speaker)])),
    [speakers],
  );
  return (
    <ol className="transcript">
      {turns.map((turn, index) => (
        <li key={turn.turn_id}>
          <button
            type="button"
            className={`transcript__line${index === activeIndex ? ' transcript__line--active' : ''}`}
            aria-current={index === activeIndex ? 'true' : undefined}
            onClick={() => {
              onSeek(turn.start_s);
            }}
          >
            <span className="transcript__time">{formatDuration(turn.start_s)}</span>
            <span className="transcript__body">
              {turn.speaker_id !== null && (
                <span className="transcript__speaker">{names.get(turn.speaker_id) ?? 'Speaker'}</span>
              )}
              <span className="transcript__text">{turn.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
