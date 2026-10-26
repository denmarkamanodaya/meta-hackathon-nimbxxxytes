// Horizontal strip of a clip's scenes; tapping one seeks the player to its start.
import { formatDuration } from '../core/format';
import { Icon } from '../design/Icon';
import type { Segment } from '../services/api/types';
import './SegmentStrip.css';

/** Props for `SegmentStrip`. */
export interface SegmentStripProps {
  segments: readonly Segment[];
  /** Index of the scene playing now, or -1. */
  activeIndex: number;
  onSeek: (seconds: number) => void;
}

/**
 * Scene cards in time order, scrollable sideways; the playing scene is outlined.
 * @param props - See `SegmentStripProps`.
 * @returns The list.
 */
export function SegmentStrip({ segments, activeIndex, onSeek }: SegmentStripProps) {
  return (
    <ul className="segment-strip">
      {segments.map((segment, index) => (
        <li key={segment.segment_id}>
          <button
            type="button"
            className={`segment-strip__card${index === activeIndex ? ' segment-strip__card--active' : ''}`}
            aria-current={index === activeIndex ? 'true' : undefined}
            aria-label={`Play from ${formatDuration(segment.start_s)}: ${segment.description ?? 'scene'}`}
            onClick={() => {
              onSeek(segment.start_s);
            }}
          >
            <span className="segment-strip__media">
              {segment.thumb_url === null ? (
                <Icon name="play" />
              ) : (
                <img className="segment-strip__img" src={segment.thumb_url} alt="" loading="lazy" />
              )}
              <span className="segment-strip__time">{formatDuration(segment.start_s)}</span>
            </span>
            <span className="segment-strip__text">{segment.description ?? 'Describing…'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
