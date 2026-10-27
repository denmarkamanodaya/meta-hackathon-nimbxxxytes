// One clip in a library day: a 3:4 thumbnail with its duration, and while the server works on
// it, a dark overlay with the current step and a progress bar. A copy of another clip is
// finished (no overlay) and carries a small "Duplicate" badge.
import { Link } from 'react-router';
import { isInProgress } from '../core/clip-view';
import { formatDuration } from '../core/format';
import { ingestProgress } from '../core/ingest-stage';
import { stepLabel } from '../core/pipeline';
import { useClipEvents } from '../hooks/useClips';
import type { ClipSummary } from '../services/api/types';
import './ClipTile.css';

/** Props for `ClipTile`. */
export interface ClipTileProps {
  clip: ClipSummary;
  /** Whether this tile may open a live SSE stream (the library caps how many do). */
  isLive: boolean;
}

const STATUS_LABEL: Record<ClipSummary['status'], string> = {
  uploading: 'Uploading…',
  uploaded: 'Understanding…',
  processing: 'Understanding…',
  ready: '',
  failed: 'Could not process',
  duplicate: '',
};

/**
 * The tile.
 * @param props - See `ClipTileProps`.
 * @returns The grid item.
 */
export function ClipTile({ clip, isLive }: ClipTileProps) {
  const event = useClipEvents(clip.clip_id, isLive);
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const label = event !== null && isInProgress(clip.status) ? stepLabel(event) : STATUS_LABEL[clip.status];
  return (
    <li>
      <Link className="clip-tile" to={`/clips/${encodeURIComponent(clip.clip_id)}`} aria-label={clip.status === 'duplicate' ? `${clip.title}, duplicate` : clip.title}>
        {clip.thumb_url !== null && <img className="clip-tile__img" src={clip.thumb_url} alt="" loading="lazy" />}
        {clip.duration_s !== null && !isWorking && (
          <span className="clip-tile__duration">{formatDuration(clip.duration_s)}</span>
        )}
        {clip.status === 'duplicate' && <span className="clip-tile__badge">Duplicate</span>}
        {isWorking && (
          <span className="clip-tile__working">
            <span className="clip-tile__step">{label}</span>
            {clip.status !== 'failed' && (
              <span className="clip-tile__track">
                <span className="clip-tile__fill" style={{ width: `${String(Math.round(ingestProgress(event) * 100))}%` }} />
              </span>
            )}
          </span>
        )}
      </Link>
    </li>
  );
}
