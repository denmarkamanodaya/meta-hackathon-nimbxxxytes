// One shot in the editable timeline: thumbnail, in–out, subject, "why this shot", what changed
// since the previous version, and the controls (drag handle, move, remove, trim).
import { useState, type CSSProperties } from 'react';
import { formatDuration } from '../core/format';
import type { ClipChange } from '../core/timeline-edit';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import type { DragReorder } from '../hooks/useGestures';
import { useSwipeDismiss } from '../hooks/useGestures';
import type { ShortSegment, TimelineClip } from '../services/api/types';
import './TimelineCard.css';

const CHANGE_LABEL: Record<ClipChange, string> = {
  added: 'New',
  removed: 'Removed',
  retimed: 'Retimed',
  moved: 'Moved',
};

/** Props for `TimelineCard`. */
export interface TimelineCardProps {
  clip: TimelineClip;
  segment: ShortSegment | undefined;
  index: number;
  count: number;
  change: ClipChange | null;
  /** Vertical offset while a drag is in progress (computed geometry). */
  offsetY: number;
  isDragging: boolean;
  dragHandle: ReturnType<DragReorder['handle']>;
  onMove: (from: number, to: number) => void;
  onDrop: (index: number) => void;
  onTrim: (index: number, edge: 'in' | 'out', seconds: number) => void;
}

function TrimControls({ clip, segment, index, onTrim }: Pick<TimelineCardProps, 'clip' | 'index' | 'onTrim'> & { segment: ShortSegment }) {
  const edges = [
    { edge: 'in' as const, label: 'Start', value: clip.in },
    { edge: 'out' as const, label: 'End', value: clip.out },
  ];
  return (
    <div className="timeline-card__trim" data-no-swipe>
      {edges.map(({ edge, label, value }) => (
        <label key={edge} className="timeline-card__slider">
          <span>{`${label} ${value.toFixed(1)} s`}</span>
          <input
            type="range"
            min={segment.start_s}
            max={segment.end_s}
            step={0.1}
            value={value}
            onChange={(event) => {
              onTrim(index, edge, Number(event.target.value));
            }}
          />
        </label>
      ))}
    </div>
  );
}

/**
 * Card for one timeline clip.
 * @param props - See `TimelineCardProps`.
 * @returns The list item (`data-reorder-item` for drag measuring).
 */
export function TimelineCard(props: TimelineCardProps) {
  const { clip, segment, index, count, change, offsetY, isDragging, dragHandle } = props;
  const [isTrimming, setTrimming] = useState(false);
  const swipe = useSwipeDismiss(() => {
    props.onDrop(index);
  });
  const style: CSSProperties = {
    transform: `translate(${String(swipe.offset)}px, ${String(offsetY)}px)`,
  };

  return (
    <li
      data-reorder-item
      className={`timeline-card${isDragging ? ' timeline-card--dragging' : ''}`}
      style={style}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
    >
      <div className="timeline-card__row">
        <button
          type="button"
          className="timeline-card__handle"
          aria-label={`Drag to reorder shot ${String(index + 1)}`}
          {...dragHandle}
        >
          <span aria-hidden="true">⋮⋮</span>
        </button>
        <span className="timeline-card__thumb">
          {segment?.thumb_url ? <img src={segment.thumb_url} alt="" loading="lazy" /> : <Icon name="play" />}
          <span className="timeline-card__index">{index + 1}</span>
        </span>
        <span className="timeline-card__body">
          <span className="timeline-card__time">
            {`${formatDuration(clip.in)}–${formatDuration(clip.out)} · ${(clip.out - clip.in).toFixed(1)} s`}
            {change !== null && <Chip tone="accent">{CHANGE_LABEL[change]}</Chip>}
          </span>
          {clip.subject !== null && <span className="timeline-card__subject">{clip.subject}</span>}
          <span className="timeline-card__why">
            <span className="timeline-card__why-label">Why this shot: </span>
            {clip.reason}
          </span>
        </span>
      </div>
      <div className="timeline-card__actions">
        <Button variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => { props.onMove(index, index - 1); }}>
          ↑
        </Button>
        <Button variant="ghost" aria-label="Move down" disabled={index === count - 1} onClick={() => { props.onMove(index, index + 1); }}>
          ↓
        </Button>
        {segment !== undefined && (
          <Button variant="ghost" aria-expanded={isTrimming} onClick={() => { setTrimming(!isTrimming); }}>
            Trim
          </Button>
        )}
        <Button variant="ghost" onClick={() => { props.onDrop(index); }}>
          <Icon name="close" />
          Remove
        </Button>
      </div>
      {isTrimming && segment !== undefined && (
        <TrimControls clip={clip} segment={segment} index={index} onTrim={props.onTrim} />
      )}
    </li>
  );
}
