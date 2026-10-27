// One clip in a library day: a 3:4 thumbnail with its duration, and while the server works on
// it, a dark overlay with one of three steps (Uploading, Understanding, Ready) over a 3-part bar.
// A copy of another clip is finished (no overlay) and carries a small "Duplicate" badge.
import { Link } from 'react-router';
import { isInProgress } from '../core/clip-view';
import { PROCESSING_COPY, PROCESSING_STEPS } from '../core/copy';
import { formatDuration } from '../core/format';
import { processingView } from '../core/processing-step';
import { StepBar } from '../design/StepBar';
import { useClipEvents } from '../hooks/useClips';
import type { ClipSummary } from '../services/api/types';
import './ClipTile.css';

/** Props for `ClipTile`. */
export interface ClipTileProps {
  clip: ClipSummary;
  /** Whether this tile may open a live SSE stream (the library caps how many do). */
  isLive: boolean;
}

/**
 * The tile.
 * @param props - See `ClipTileProps`.
 * @returns The grid item.
 */
export function ClipTile({ clip, isLive }: ClipTileProps) {
  const event = useClipEvents(clip.clip_id, isLive);
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const view = processingView(clip.status, event);
  return (
    <li>
      <Link className="clip-tile" to={`/clips/${encodeURIComponent(clip.clip_id)}`} aria-label={clip.status === 'duplicate' ? `${clip.title}, duplicate` : clip.title}>
        {clip.thumb_url !== null && <img className="clip-tile__img" src={clip.thumb_url} alt="" loading="lazy" />}
        {clip.duration_s !== null && !isWorking && (
          <span className="clip-tile__duration">{formatDuration(clip.duration_s)}</span>
        )}
        {clip.status === 'duplicate' && <span className="clip-tile__badge">{PROCESSING_COPY.duplicate}</span>}
        {isWorking && (
          <span className="clip-tile__working">
            <span className="clip-tile__step">{view.label}</span>
            {view.kind === 'step' && (
              <StepBar steps={PROCESSING_STEPS.length} current={view.step} within={view.within} tone="media" />
            )}
          </span>
        )}
      </Link>
    </li>
  );
}
