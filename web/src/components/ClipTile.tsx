// One clip in a library day: a 3:4 thumbnail with its duration, and while the server works on
// it, a dark overlay with one of three steps (Uploading, Understanding, Ready) over a 3-part bar.
// A copy of another clip is finished (no overlay) and carries a small "Duplicate" badge. With
// `pick` (the Library's Select mode, or a long press into it) a tap ticks the clip instead of
// opening it, and a round tick shows top right.
import { Link } from 'react-router';
import { isInProgress } from '../core/clip-view';
import { PROCESSING_COPY, PROCESSING_STEPS } from '../core/copy';
import { formatDuration } from '../core/format';
import { processingView } from '../core/processing-step';
import { Icon } from '../design/Icon';
import { StepBar } from '../design/StepBar';
import { useClipEvents } from '../hooks/useClips';
import { useLongPress } from '../hooks/useLongPress';
import type { ClipSummary } from '../services/api/types';
import './ClipTile.css';

/** Props for `ClipTile`. */
export interface ClipTileProps {
  clip: ClipSummary;
  /** Whether this tile may open a live SSE stream (the library caps how many do). */
  isLive: boolean;
  /** Select mode: whether the clip is ticked; null when the Library is not selecting. */
  isPicked: boolean | null;
  /** A tap in Select mode. */
  onPick: () => void;
  /** A long press: Select mode on with this clip ticked. */
  onHold: () => void;
}

/**
 * The tile.
 * @param props - See `ClipTileProps`.
 * @returns The grid item.
 */
export function ClipTile({ clip, isLive, isPicked, onPick, onHold }: ClipTileProps) {
  const event = useClipEvents(clip.clip_id, isLive);
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const view = processingView(clip.status, event);
  const press = useLongPress(onHold);
  const label = clip.status === 'duplicate' ? `${clip.title}, duplicate` : clip.title;
  return (
    <li>
      <Link
        className={isPicked === true ? 'clip-tile clip-tile--picked' : 'clip-tile'}
        to={`/clips/${encodeURIComponent(clip.clip_id)}`}
        aria-label={isPicked === null ? label : `${label}, ${isPicked ? 'selected' : 'not selected'}`}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onClick={(click) => {
          if (press.swallowClick(click) || isPicked === null) return;
          click.preventDefault();
          onPick();
        }}
      >
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
        {isPicked !== null && (
          <span className={isPicked ? 'clip-tile__tick clip-tile__tick--on' : 'clip-tile__tick'} aria-hidden="true">
            {isPicked && <Icon name="check" size="sm" />}
          </span>
        )}
      </Link>
    </li>
  );
}
