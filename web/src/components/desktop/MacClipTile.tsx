// One clip in the Mac Library grid (M1, without the on-Mac badges since v1.1): the 3:4 thumbnail
// with its duration, and the title plus a sub line for clips that are not ready. ⌘-click selects
// it (accent outline) and right-click opens the clip menu (mock V4); the page handles both. Clips the server
// still works on show the same step overlay as the PWA tile.
import type { MouseEvent } from 'react';
import { Link } from 'react-router';
import { isInProgress } from '../../core/clip-view';
import { formatDuration } from '../../core/format';
import { ingestProgress } from '../../core/ingest-stage';
import { stepLabel } from '../../core/pipeline';
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

function Overlay({ label, percent }: { label: string; percent: number | null }) {
  return (
    <span className="mac-clip-tile__overlay">
      <span className="mac-clip-tile__overlay-label">{label}</span>
      {percent !== null && (
        <span className="mac-clip-tile__track">
          <span className="mac-clip-tile__fill" style={{ width: `${String(percent)}%` }} />
        </span>
      )}
    </span>
  );
}

function WorkingOverlay({ clip, isLive }: { clip: ClipSummary; isLive: boolean }) {
  const event = useClipEvents(clip.clip_id, isLive);
  if (clip.status === 'failed') return <Overlay label="Could not process" percent={null} />;
  const waiting = clip.status === 'uploading' ? 'Uploading…' : 'Understanding…';
  const label = event === null ? waiting : stepLabel(event);
  return <Overlay label={label} percent={Math.round(ingestProgress(event) * 100)} />;
}

function subLine(clip: ClipSummary): string | null {
  if (clip.status === 'duplicate') return 'Duplicate';
  return clip.status === 'ready' ? null : 'In your cloud';
}

/**
 * The tile.
 * @param props - See `MacClipTileProps`.
 * @returns The grid item.
 */
export function MacClipTile({ clip, isLive, isSelected, onClick, onContextMenu }: MacClipTileProps) {
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const sub = subLine(clip);
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
          {isWorking && <WorkingOverlay clip={clip} isLive={isLive} />}
        </span>
        <span className="mac-clip-tile__caption">{clip.title}</span>
        {sub !== null && <span className="mac-clip-tile__sub">{sub}</span>}
      </Link>
    </li>
  );
}
