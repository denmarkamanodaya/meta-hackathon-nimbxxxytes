// One search result: the moment's thumbnail and time, why it matched, and which clip it is in.
// In select mode a tap toggles it; a long press anywhere enters select mode with it picked.
import { formatDuration, formatShortDate } from '../core/format';
import { Icon } from '../design/Icon';
import { useLongPress } from '../hooks/useLongPress';
import type { SearchResult } from '../services/api/types';
import './SearchResultCard.css';

/** Props for `SearchResultCard`. */
export interface SearchResultCardProps {
  result: SearchResult;
  isSelectMode: boolean;
  isSelected: boolean;
  /** "Now" for the date's year check. */
  now: Date;
  /** Opens the clip at this moment (normal mode). */
  onOpen: (result: SearchResult) => void;
  /** Toggles this moment (select mode, or after a long press). */
  onToggle: (segmentId: string) => void;
  /** A long press: enter select mode with this moment picked. */
  onLongPress: (segmentId: string) => void;
}

/**
 * Pressable result card.
 * @param props - See `SearchResultCardProps`.
 * @returns The list item.
 */
export function SearchResultCard(props: SearchResultCardProps) {
  const { result, isSelectMode, isSelected, now } = props;
  const press = useLongPress(() => {
    props.onLongPress(result.segment_id);
  });
  const date = result.recorded_at === null ? '' : formatShortDate(result.recorded_at, now);
  const span = `${formatDuration(result.start_s)}–${formatDuration(result.end_s)}`;

  return (
    <li>
      <button
        type="button"
        className={`result-card${isSelected ? ' result-card--selected' : ''}`}
        aria-pressed={isSelectMode ? isSelected : undefined}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onPointerLeave={press.onPointerLeave}
        onContextMenu={(event) => {
          event.preventDefault();
        }}
        onClick={() => {
          if (press.consumeLongPress()) return;
          if (isSelectMode) props.onToggle(result.segment_id);
          else props.onOpen(result);
        }}
      >
        <span className="result-card__media">
          {result.thumb_url === null ? (
            <Icon name="play" />
          ) : (
            <img className="result-card__img" src={result.thumb_url} alt="" loading="lazy" />
          )}
          <span className="result-card__time">{formatDuration(result.start_s)}</span>
          {isSelectMode && (
            <span className="result-card__check" aria-hidden="true">
              {isSelected && <Icon name="check" />}
            </span>
          )}
        </span>
        <span className="result-card__body">
          <span className={`result-card__reason${result.reason === null ? ' result-card__reason--none' : ''}`}>
            {result.reason ?? 'Matching moment'}
          </span>
          <span className="result-card__meta">
            {[result.clip_filename, date, span].filter((part) => part !== '').join(' · ')}
          </span>
        </span>
      </button>
    </li>
  );
}
