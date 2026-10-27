// The clip's "Said" list (Mist): mono time, then the speaker in bold and what they said.
// Tapping a line's time seeks the player; tapping the speaker's name opens the rename sheet.
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
 * The list.
 * @param props - See `TranscriptListProps`.
 * @returns The list.
 */
export function TranscriptList(props: TranscriptListProps) {
  const { turns, speakers, activeIndex, onSeek, onRenameSpeaker } = props;
  const byId = useMemo(() => new Map(speakers.map((speaker) => [speaker.speaker_id, speaker])), [speakers]);
  return (
    <ol className="said">
      {turns.map((turn, index) => {
        const speaker = turn.speaker_id === null ? undefined : byId.get(turn.speaker_id);
        const isActive = index === activeIndex;
        return (
          <li key={turn.turn_id} className={isActive ? 'said__turn said__turn--active' : 'said__turn'} aria-current={isActive ? 'true' : undefined}>
            <button
              type="button"
              className="said__time"
              aria-label={`Play from ${formatDuration(turn.start_s)}`}
              onClick={() => {
                onSeek(turn.start_s);
              }}
            >
              {formatDuration(turn.start_s)}
            </button>
            <span className="said__line">
              {speaker !== undefined && (
                <button
                  type="button"
                  className="said__speaker"
                  aria-label={`${speakerName(speaker)}. Rename speaker`}
                  onClick={() => {
                    onRenameSpeaker(speaker);
                  }}
                >
                  {speakerName(speaker)}
                </button>
              )}{' '}
              <span className="said__text">{turn.text}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
