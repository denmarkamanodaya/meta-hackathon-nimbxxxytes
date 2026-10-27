// Status line for a clip: live step while processing, a chip when failed, nothing when ready.
import { PROCESSING_COPY } from '../core/copy';
import { stepLabel } from '../core/pipeline';
import { Chip } from '../design/Chip';
import { Spinner } from '../design/Spinner';
import { useClipEvents } from '../hooks/useClips';
import type { ClipStatus } from '../services/api/types';
import './ClipStatusLine.css';

const STATUS_LABEL: Record<ClipStatus, string> = {
  uploading: 'Uploading…',
  uploaded: 'Queued for processing',
  processing: 'Processing…',
  ready: 'Ready',
  failed: PROCESSING_COPY.failed,
  duplicate: 'Copy of a clip you already have',
};

/** Props for `ClipStatusLine`. */
export interface ClipStatusLineProps {
  clipId: string;
  status: ClipStatus;
  /** Open an SSE stream for live steps (the Library caps how many clips do). */
  isLive: boolean;
}

/**
 * Shows what the pipeline is doing right now, from SSE when live, else from the polled status.
 * @param props - See `ClipStatusLineProps`.
 * @returns The status line, or null for a ready clip.
 */
export function ClipStatusLine({ clipId, status, isLive }: ClipStatusLineProps) {
  const event = useClipEvents(clipId, isLive);
  if (status === 'ready') return null;
  if (status === 'failed' || event?.status === 'failed') {
    return <Chip tone="danger">{event === null ? STATUS_LABEL.failed : stepLabel(event)}</Chip>;
  }
  return (
    <span className="clip-status-line" role="status">
      <Spinner />
      {event === null ? STATUS_LABEL[status] : stepLabel(event)}
    </span>
  );
}
