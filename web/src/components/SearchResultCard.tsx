// One search result (Mist): 72×96 thumbnail, the mono time range (accent when picked), clip
// title and day, the reason (two grey lines while Muse Spark refines) and the named faces. Tapping
// the card opens the clip at that second. In select mode the whole card is the label of a square
// 44 px checkbox that picks the moment for a short.
import { dayLabel } from '../core/day-groups';
import { formatDuration } from '../core/format';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import type { SearchResult } from '../services/api/types';
import './SearchResultCard.css';

/** Props for `SearchResultCard`. */
export interface SearchResultCardProps {
  result: SearchResult;
  /** Select mode: the card picks instead of opening. */
  isSelecting: boolean;
  isPicked: boolean;
  /** True while the ranked stage is pending: a missing reason shows as two grey lines. */
  isRefining: boolean;
  /** "Now" for the day word. */
  now: Date;
  onOpen: (result: SearchResult) => void;
  onTogglePick: (segmentId: string) => void;
}

function Body({ result, span, day, isRefining }: { result: SearchResult; span: string; day: string; isRefining: boolean }) {
  const names = result.faces.map((face) => face.name).join(', ');
  return (
    <>
      <span className="result-card__thumb">
        {result.thumb_url !== null && <img src={result.thumb_url} alt="" loading="lazy" />}
      </span>
      <span className="result-card__body">
        <span className="result-card__head">
          <span className="result-card__time">{span}</span>
          <span className="result-card__clip">{day === '' ? result.clip_title : `${result.clip_title} · ${day}`}</span>
        </span>
        {result.reason === null && isRefining ? (
          <span className="result-card__reason-pending" aria-hidden="true">
            <span className="result-card__reason-line">
              <Skeleton kind="line" />
            </span>
            <Skeleton kind="line-short" />
          </span>
        ) : (
          <span className="result-card__reason">{result.reason ?? 'Matching moment'}</span>
        )}
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
    </>
  );
}

/**
 * The card.
 * @param props - See `SearchResultCardProps`.
 * @returns The list item.
 */
export function SearchResultCard({ result, isSelecting, isPicked, isRefining, now, onOpen, onTogglePick }: SearchResultCardProps) {
  const day = result.recorded_at === null ? '' : dayLabel(result.recorded_at, now);
  const span = `${formatDuration(result.start_s)}–${formatDuration(result.end_s)}`;
  const body = <Body result={result} span={span} day={day} isRefining={isRefining} />;
  return (
    <li className={isPicked ? 'result-card result-card--picked' : 'result-card'} data-flip-key={result.segment_id}>
      {isSelecting ? (
        <label className="result-card__open result-card__open--select">
          {body}
          <span className="result-card__check">
            <input
              type="checkbox"
              className="result-card__input visually-hidden"
              checked={isPicked}
              aria-label={`Pick ${span}, ${result.clip_title}`}
              onChange={() => {
                onTogglePick(result.segment_id);
              }}
            />
            <span className="result-card__box" aria-hidden="true">
              {isPicked && <Icon name="check" size="sm" />}
            </span>
          </span>
        </label>
      ) : (
        <button
          type="button"
          className="result-card__open"
          onClick={() => {
            onOpen(result);
          }}
        >
          {body}
        </button>
      )}
    </li>
  );
}
