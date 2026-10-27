// One search result (Mist): 72×96 thumbnail, the mono time range (accent when picked), clip
// title and day, the reason, the named faces, and a round pick toggle. Tapping the card opens
// the clip at that second; the toggle picks the moment for a short.
import { dayLabel } from '../core/day-groups';
import { formatDuration } from '../core/format';
import { Icon } from '../design/Icon';
import type { SearchResult } from '../services/api/types';
import './SearchResultCard.css';

/** Props for `SearchResultCard`. */
export interface SearchResultCardProps {
  result: SearchResult;
  isPicked: boolean;
  /** "Now" for the day word. */
  now: Date;
  onOpen: (result: SearchResult) => void;
  onTogglePick: (segmentId: string) => void;
}

/**
 * The card.
 * @param props - See `SearchResultCardProps`.
 * @returns The list item.
 */
export function SearchResultCard({ result, isPicked, now, onOpen, onTogglePick }: SearchResultCardProps) {
  const day = result.recorded_at === null ? '' : dayLabel(result.recorded_at, now);
  const span = `${formatDuration(result.start_s)}–${formatDuration(result.end_s)}`;
  const names = result.faces.map((face) => face.name).join(', ');
  return (
    <li className={isPicked ? 'result-card result-card--picked' : 'result-card'}>
      <button
        type="button"
        className="result-card__open"
        onClick={() => {
          onOpen(result);
        }}
      >
        <span className="result-card__thumb">
          {result.thumb_url !== null && <img src={result.thumb_url} alt="" loading="lazy" />}
        </span>
        <span className="result-card__body">
          <span className="result-card__head">
            <span className="result-card__time">{span}</span>
            <span className="result-card__clip">{day === '' ? result.clip_title : `${result.clip_title} · ${day}`}</span>
          </span>
          <span className="result-card__reason">{result.reason ?? 'Matching moment'}</span>
          {result.faces.length > 0 && (
            <span className="result-card__faces">
              {result.faces.map((face) => (
                <span key={face.name} className="result-card__face">
                  {face.crop_url !== null && <img src={face.crop_url} alt="" />}
                </span>
              ))}
              <span className="result-card__names">{names}</span>
            </span>
          )}
        </span>
      </button>
      <button
        type="button"
        className="result-card__pick"
        aria-pressed={isPicked}
        aria-label={isPicked ? `Unpick ${span}` : `Pick ${span} for a short`}
        onClick={() => {
          onTogglePick(result.segment_id);
        }}
      >
        <span className="result-card__pick-dot">{isPicked && <Icon name="check" size="xs" />}</span>
      </button>
    </li>
  );
}
