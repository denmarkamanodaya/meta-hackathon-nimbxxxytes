// One clip in the Library grid: thumbnail with duration, name, date, live status, people.
import { Link } from 'react-router';
import { formatDuration, formatShortDate } from '../core/format';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import type { ClipSummary } from '../services/api/types';
import { ClipStatusLine } from './ClipStatusLine';
import './ClipCard.css';

const MAX_PEOPLE_CHIPS = 2;

/** Props for `ClipCard`. */
export interface ClipCardProps {
  clip: ClipSummary;
  /** Whether this card may open a live SSE stream. */
  isLive: boolean;
  /** "Now" for the date's year check. */
  now: Date;
}

/**
 * Tappable card that opens the clip detail page.
 * @param props - See `ClipCardProps`.
 * @returns The grid item.
 */
export function ClipCard({ clip, isLive, now }: ClipCardProps) {
  const date = clip.recorded_at === null ? '' : formatShortDate(clip.recorded_at, now);
  const extraPeople = clip.people.length - MAX_PEOPLE_CHIPS;

  return (
    <li className="clip-card">
      <Link className="clip-card__link" to={`/clips/${encodeURIComponent(clip.clip_id)}`}>
        <span className="clip-card__media">
          {clip.thumb_url === null ? (
            <span className="clip-card__placeholder">
              <Icon name="cloud" />
            </span>
          ) : (
            <img className="clip-card__img" src={clip.thumb_url} alt="" loading="lazy" />
          )}
          {clip.duration_s !== null && (
            <span className="clip-card__duration">{formatDuration(clip.duration_s)}</span>
          )}
        </span>
        <span className="clip-card__body">
          <span className="clip-card__name">{clip.filename}</span>
          <span className="clip-card__meta">
            {[date, clip.segment_count > 0 ? `${String(clip.segment_count)} scenes` : '']
              .filter((part) => part !== '')
              .join(' · ')}
          </span>
          <ClipStatusLine clipId={clip.clip_id} status={clip.status} isLive={isLive} />
          {clip.people.length > 0 && (
            <span className="clip-card__people">
              {clip.people.slice(0, MAX_PEOPLE_CHIPS).map((name) => (
                <Chip key={name} tone="accent">
                  {name}
                </Chip>
              ))}
              {extraPeople > 0 && <Chip>{`+${String(extraPeople)}`}</Chip>}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}
