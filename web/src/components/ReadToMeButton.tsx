// "Read it to me" (owner ruling 2026-10-29: the summary first, then the whole letter part by part);
// while it reads, the same button says "Stop reading". The no-voice line shows under it when there
// is no voice right now. It reads the stored summary and letter text in the device's own voice (the
// server's WAV only as the fallback). Each page sizes it its own way through `className`.
import { IREAD_COPY } from '../core/iread/documents';
import { FROM_SUMMARY } from '../core/iread/read-aloud';
import { Icon } from '../design/Icon';
import type { ReadAloud } from '../hooks/useReadAloud';
import type { DocumentDetail } from '../services/api/types';

/** Props for `ReadToMeButton`. */
export interface ReadToMeButtonProps {
  doc: Pick<DocumentDetail, 'id' | 'summary' | 'text' | 'summary_audio_url'>;
  player: ReadAloud;
  className: string;
  /** The line under it ("Voice not available right now"). */
  messageClassName: string;
}

/**
 * The button and its line.
 * @param props - See `ReadToMeButtonProps`.
 * @returns The button.
 */
export function ReadToMeButton({ doc, player, className, messageClassName }: ReadToMeButtonProps) {
  const isReading = player.status !== 'idle';
  return (
    <>
      <button
        type="button"
        className={className}
        aria-pressed={isReading}
        onClick={() => {
          if (isReading) player.stop();
          else player.readDocument(doc, FROM_SUMMARY);
        }}
      >
        <Icon name="speaker" size="md" />
        {isReading ? IREAD_COPY.stopReading : IREAD_COPY.readToMe}
      </button>
      {player.message !== null && (
        <p className={messageClassName} role="status">
          {player.message}
        </p>
      )}
    </>
  );
}
