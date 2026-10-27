// One clip in the Mac Library grid (M1, without the on-Mac badges since v1.1): the 3:4 thumbnail
// with its duration, and the title plus a sub line for clips that are not ready. ⌘-click selects
// it (accent outline) and right-click opens the clip menu (mock V4); the page handles both. Clips the server
// still works on show the same step overlay as the PWA tile. In the dark theme a ready tile shows a
// play button on hover (CSS only; hidden in light). Processing reads as three steps (Uploading,
// Understanding, Ready) with "Step 2 of 3" under the title.
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { isInProgress } from '../../core/clip-view';
import { PROCESSING_STEPS, stepOfLine } from '../../core/copy';
import { formatDuration } from '../../core/format';
import { processingView, type ProcessingView } from '../../core/processing-step';
import { Icon } from '../../design/Icon';
import { StepBar } from '../../design/StepBar';
import { useClipEvents } from '../../hooks/useClips';
import type { ClipSummary } from '../../services/api/types';
import './MacClipTile.css';

/** Props for `MacClipTile`. */
export interface MacClipTileProps {
  clip: ClipSummary;
  /** Whether this tile may open a live SSE stream (the library caps how many do). */
  isLive: boolean;
  /** Part of the ⌘-click selection: drawn with an accent outline. */
  isSelected: boolean;
  /** Any click; the page decides between opening and selecting (it prevents the default). */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Right-click: the clip menu. */
  onContextMenu: (event: MouseEvent<HTMLAnchorElement>) => void;
}

function Overlay({ view }: { view: ProcessingView }) {
  return (
    <span className="mac-clip-tile__overlay">
      <span className="mac-clip-tile__overlay-label">{view.label}</span>
      {view.kind === 'step' && <StepBar steps={PROCESSING_STEPS.length} current={view.step} within={view.within} tone="media" />}
    </span>
  );
}

function subLine(clip: ClipSummary, view: ProcessingView): string | null {
  if (view.kind === 'duplicate') return view.label;
  return isInProgress(clip.status) && view.kind === 'step' ? stepOfLine(view.step) : null;
}

/**
 * The tile.
 * @param props - See `MacClipTileProps`.
 * @returns The grid item.
 */
export function MacClipTile({ clip, isLive, isSelected, onClick, onContextMenu }: MacClipTileProps) {
  const event = useClipEvents(clip.clip_id, isLive);
  const view = processingView(clip.status, event);
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const sub = subLine(clip, view);
  return (
    <li>
      <Link
        className={isSelected ? 'mac-clip-tile mac-clip-tile--selected' : 'mac-clip-tile'}
        to={`/clips/${encodeURIComponent(clip.clip_id)}`}
        aria-current={isSelected ? 'true' : undefined}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        <span className="mac-clip-tile__thumb">
          {clip.thumb_url !== null && <img className="mac-clip-tile__img" src={clip.thumb_url} alt="" loading="lazy" />}
          {clip.duration_s !== null && !isWorking && (
            <span className="mac-clip-tile__duration">{formatDuration(clip.duration_s)}</span>
          )}
          {isWorking && <Overlay view={view} />}
          {!isWorking && (
            <span className="mac-clip-tile__play" aria-hidden="true">
              <Icon name="play" size="sm" />
            </span>
          )}
        </span>
        <span className="mac-clip-tile__caption">{clip.title}</span>
        {sub !== null && <span className="mac-clip-tile__sub">{sub}</span>}
      </Link>
    </li>
  );
}
