// One clip in the Library list: thumbnail (or placeholder), name, duration and status.
import { Link } from 'react-router';
import { formatDuration } from '../core/format';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import type { ClipStatus, ClipSummary } from '../services/api/types';
import './ClipRow.css';

const STATUS_LABEL: Record<ClipStatus, string> = {
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
};

const STATUS_TONE = {
  uploading: 'neutral',
  uploaded: 'accent',
  processing: 'accent',
  ready: 'success',
  failed: 'danger',
} as const;

/** Props for `ClipRow`. */
export interface ClipRowProps {
  /** The clip to show. */
  clip: ClipSummary;
}

/**
 * Tappable row that opens the clip detail page.
 * @param props - See `ClipRowProps`.
 * @returns The list item.
 */
export function ClipRow({ clip }: ClipRowProps) {
  const meta = [
    clip.duration_s === null ? null : formatDuration(clip.duration_s),
    clip.segment_count > 0 ? `${String(clip.segment_count)} scenes` : null,
  ].filter((part) => part !== null);

  return (
    <li>
      <Link className="clip-row" to={`/clips/${encodeURIComponent(clip.clip_id)}`}>
        <span className="clip-row__thumb">
          {clip.thumb_url === null ? (
            <Icon name="cloud" />
          ) : (
            <img className="clip-row__img" src={clip.thumb_url} alt="" width={64} height={64} />
          )}
        </span>
        <span className="clip-row__text">
          <span className="clip-row__name">{clip.filename}</span>
          {meta.length > 0 && <span className="clip-row__meta">{meta.join(' · ')}</span>}
        </span>
        <Chip tone={STATUS_TONE[clip.status]}>{STATUS_LABEL[clip.status]}</Chip>
      </Link>
    </li>
  );
}
