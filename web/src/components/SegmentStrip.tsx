// The clip's Moments list (P3): one row per moment with its thumbnail, the mono time range
// (accent when playing) and a short description. Tapping one seeks the player to its start.
import { formatDuration } from '../core/format';
import type { Segment } from '../services/api/types';
import './SegmentStrip.css';

/** Props for `SegmentStrip`. */
export interface SegmentStripProps {
  segments: readonly Segment[];
  /** Index of the moment playing now, or -1. */
  activeIndex: number;
  onSeek: (seconds: number) => void;
}

/**
 * The list.
 * @param props - See `SegmentStripProps`.
 * @returns The list.
 */
export function SegmentStrip({ segments, activeIndex, onSeek }: SegmentStripProps) {
  return (
    <ul className="moments">
      {segments.map((segment, index) => {
        const isActive = index === activeIndex;
        const span = `${formatDuration(segment.start_s)}–${formatDuration(segment.end_s)}`;
        return (
          <li key={segment.segment_id}>
            <button
              type="button"
              className={isActive ? 'moments__row moments__row--active' : 'moments__row'}
              aria-current={isActive ? 'true' : undefined}
              aria-label={`Play from ${formatDuration(segment.start_s)}: ${segment.description ?? 'moment'}`}
              onClick={() => {
                onSeek(segment.start_s);
              }}
            >
              <span className="moments__thumb">
                {segment.thumb_url !== null && <img src={segment.thumb_url} alt="" loading="lazy" />}
              </span>
              <span className="moments__body">
                <span className="moments__time">{span}</span>
                <span className="moments__text">{segment.description ?? 'Describing…'}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
