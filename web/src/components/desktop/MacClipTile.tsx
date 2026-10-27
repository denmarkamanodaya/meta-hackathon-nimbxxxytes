// One clip in the Mac Library grid (M1): the 3:4 thumbnail with its duration and a badge for
// where it is on this Mac (On Mac, Original), a "Syncing to Mac…" overlay with progress while its
// proxy downloads, and the title plus a sub line under the tile. Clips the server still works on
// show the same step overlay as the PWA tile.
import { Link } from 'react-router';
import { isInProgress } from '../../core/clip-view';
import type { ClipDiskState } from '../../core/desktop-sync';
import { formatDuration } from '../../core/format';
import { ingestProgress } from '../../core/ingest-stage';
import { stepLabel } from '../../core/pipeline';
import { useClipEvents } from '../../hooks/useClips';
import type { ClipSummary } from '../../services/api/types';
import './MacClipTile.css';

/** Props for `MacClipTile`. */
export interface MacClipTileProps {
  clip: ClipSummary;
  /** Where the clip is on this Mac; ignored until the clip is ready. */
  disk: ClipDiskState;
  /** Whether this tile may open a live SSE stream (the library caps how many do). */
  isLive: boolean;
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

function subLine(clip: ClipSummary, disk: ClipDiskState): string {
  if (clip.status === 'duplicate') return 'Duplicate';
  if (clip.status !== 'ready') return 'In your cloud';
  return disk.line;
}

/**
 * The tile.
 * @param props - See `MacClipTileProps`.
 * @returns The grid item.
 */
export function MacClipTile({ clip, disk, isLive }: MacClipTileProps) {
  const isWorking = isInProgress(clip.status) || clip.status === 'failed';
  const isReady = clip.status === 'ready';
  return (
    <li>
      <Link className="mac-clip-tile" to={`/clips/${encodeURIComponent(clip.clip_id)}`}>
        <span className="mac-clip-tile__thumb">
          {clip.thumb_url !== null && <img className="mac-clip-tile__img" src={clip.thumb_url} alt="" loading="lazy" />}
          {isReady && disk.kind === 'on-mac' && <span className="mac-clip-tile__badge mac-clip-tile__badge--on-mac">{disk.badge}</span>}
          {isReady && disk.kind === 'original' && (
            <span className="mac-clip-tile__badge mac-clip-tile__badge--original">
              <svg className="mac-clip-tile__badge-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
              {disk.badge}
            </span>
          )}
          {clip.duration_s !== null && !isWorking && !(isReady && disk.kind === 'syncing') && (
            <span className="mac-clip-tile__duration">{formatDuration(clip.duration_s)}</span>
          )}
          {isReady && disk.kind === 'syncing' && <Overlay label="Syncing to Mac…" percent={disk.percent} />}
          {isWorking && <WorkingOverlay clip={clip} isLive={isLive} />}
        </span>
        <span className="mac-clip-tile__caption">{clip.title}</span>
        <span className="mac-clip-tile__sub">{subLine(clip, disk)}</span>
      </Link>
    </li>
  );
}
