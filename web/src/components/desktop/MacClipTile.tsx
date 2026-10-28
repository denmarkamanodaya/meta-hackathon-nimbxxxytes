// One clip in the Mac Gallery grid (redesign v2, Gallery V1): a square thumbnail with the
// availability badge top left (in the cloud, partly on this Mac, kept offline) and the length
// bottom right, then the title and "26 Oct 2026 · 3 moments". A click selects it (accent ring), a
// double click opens it, right-click opens the clip menu; the page handles all three. In Select
// mode a round tick top right shows whether it is ticked. Clips the
// server still works on show the step overlay and "Step 2 of 3" instead.
import type { DragEvent, MouseEvent } from 'react';
import { Link } from 'react-router';
import { isInProgress } from '../../core/clip-view';
import { PROCESSING_STEPS, stepOfLine } from '../../core/copy';
import { formatDuration } from '../../core/format';
import { tileLine, WHERE_LABEL } from '../../core/gallery';
import type { Availability } from '../../core/on-this-mac';
import { processingView, type ProcessingView } from '../../core/processing-step';
import { Icon } from '../../design/Icon';
import { StepBar } from '../../design/StepBar';
import { useClipEvents } from '../../hooks/useClips';
import type { ClipSummary } from '../../services/api/types';
import { AvailabilityIcon } from './AvailabilityIcon';
import './MacClipTile.css';

/** Props for `MacClipTile`. */
export interface MacClipTileProps {
  clip: ClipSummary;
  /** Whether this tile may open a live SSE stream (the page caps how many do). */
  isLive: boolean;
  /** Selected: drawn with the accent ring. */
  isSelected: boolean;
  /** Select mode is on: the tile shows its tick. */
  isSelecting?: boolean;
  /** Where the clip is on this Mac. */
  availability: Availability;
  /** Any click; the page selects (it prevents the link's default). */
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Double click: open. */
  onOpen: () => void;
  /** Right-click: the clip menu. */
  onContextMenu: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Dragging it (onto a project). */
  onDragStart: (event: DragEvent<HTMLAnchorElement>) => void;
}

function Overlay({ view }: { view: ProcessingView }) {
  return (
    <span className="mac-clip-tile__overlay">
      <span className="mac-clip-tile__overlay-label">{view.label}</span>
      {view.kind === 'step' && <StepBar steps={PROCESSING_STEPS.length} current={view.step} within={view.within} tone="media" />}
    </span>
  );
}

function subLine(clip: ClipSummary, view: ProcessingView): string {
  if (view.kind === 'duplicate') return view.label;
  if (isInProgress(clip.status)) return view.kind === 'step' ? stepOfLine(view.step) : '';
  return tileLine(clip);
}

/**
 * The tile.
 * @param props - See `MacClipTileProps`.
 * @returns The grid item.
 */
export function MacClipTile({ clip, isLive, isSelected, isSelecting = false, availability, onClick, onOpen, onContextMenu, onDragStart }: MacClipTileProps) {
  const event = useClipEvents(clip.clip_id, isLive);
  const view = processingView(clip.status, event);
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  return (
    <li className="mac-clip-tile">
      <Link
        className={isSelected ? 'mac-clip-tile__thumb mac-clip-tile__thumb--selected' : 'mac-clip-tile__thumb'}
        to={`/clips/${encodeURIComponent(clip.clip_id)}`}
        aria-label={clip.title}
        aria-current={isSelected ? 'true' : undefined}
        onClick={onClick}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
      >
        {clip.thumb_url === null ? (
          <span className="mac-clip-tile__placeholder" aria-hidden="true">
            <Icon name="film" size="lg" />
          </span>
        ) : (
          <img className="mac-clip-tile__img" src={clip.thumb_url} alt="" loading="lazy" />
        )}
        {isWorking ? (
          <Overlay view={view} />
        ) : (
          <span className="mac-clip-tile__where" title={WHERE_LABEL[availability]}>
            <AvailabilityIcon state={availability} size="badge" isLabelled />
          </span>
        )}
        {clip.duration_s !== null && !isWorking && <span className="mac-clip-tile__duration">{formatDuration(clip.duration_s)}</span>}
        {isSelecting && (
          <span className={isSelected ? 'mac-clip-tile__tick mac-clip-tile__tick--on' : 'mac-clip-tile__tick'} aria-hidden="true">
            {isSelected && <Icon name="check" size="xs" />}
          </span>
        )}
      </Link>
      <span className="mac-clip-tile__caption">{clip.title}</span>
      <span className="mac-clip-tile__sub">{subLine(clip, view)}</span>
    </li>
  );
}
