// Transcript lines with speaker names. Tapping a line seeks the player; tapping a speaker's
// name opens the rename sheet.
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
  onRenameSpeaker: (speaker: Speaker) => void;
}

/**
 * One row per turn: speaker (renamable), time, and the text (seeks). The playing line is tinted.
 * @param props - See `TranscriptListProps`.
 * @returns The list.
 */
export function TranscriptList(props: TranscriptListProps) {
  const { turns, speakers, activeIndex, onSeek, onRenameSpeaker } = props;
  const byId = useMemo(
    () => new Map(speakers.map((speaker) => [speaker.speaker_id, speaker])),
    [speakers],
  );
  return (
    <ol className="transcript">
      {turns.map((turn, index) => {
        const speaker = turn.speaker_id === null ? undefined : byId.get(turn.speaker_id);
        const isActive = index === activeIndex;
        return (
          <li
            key={turn.turn_id}
            className={`transcript__line${isActive ? ' transcript__line--active' : ''}`}
            aria-current={isActive ? 'true' : undefined}
          >
            <div className="transcript__head">
              {speaker !== undefined && (
                <button
                  type="button"
                  className="transcript__speaker"
                  aria-label={`${speakerName(speaker)}. Rename speaker`}
                  onClick={() => {
                    onRenameSpeaker(speaker);
                  }}
                >
                  {speakerName(speaker)}
                </button>
              )}
              <span className="transcript__time">{formatDuration(turn.start_s)}</span>
            </div>
            <button
              type="button"
              className="transcript__text"
              onClick={() => {
                onSeek(turn.start_s);
              }}
            >
              {turn.text}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
