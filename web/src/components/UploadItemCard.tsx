// One file on the Upload screen (Mist): while sending, the part count, a progress bar and the
// bytes; once sent, the five processing dots from its live steps; when ready, what it found;
// before its turn, "Waiting"; after a failure, Retry.
import { ingestStage, INGEST_STAGES } from '../core/ingest-stage';
import { formatBytes } from '../core/format';
import { isInProgress } from '../core/clip-view';
import { Button } from '../design/Button';
import { useClipEvents } from '../hooks/useClips';
import type { ClipSummary } from '../services/api/types';
import type { UploadItem } from '../services/upload/queue';
import './UploadItemCard.css';

/** Props for `UploadItemCard`. */
export interface UploadItemCardProps {
  item: UploadItem;
  /** The clip this upload became, once the library lists it. */
  clip: ClipSummary | undefined;
  onRetry: (id: string) => void;
}

const titleOf = (item: UploadItem, clip: ClipSummary | undefined) => clip?.title ?? item.name.replace(/\.[^.]+$/, '');

function Dots({ done, tone }: { done: number; tone: 'accent' | 'success' }) {
  return (
    <span className="upload-item__steps" aria-label={done >= INGEST_STAGES.length ? 'Done' : `Step ${String(done)} of ${String(INGEST_STAGES.length)}`}>
      {INGEST_STAGES.map((stage, index) => (
        <span key={stage} className={index < done ? `upload-item__step upload-item__step--${tone}` : 'upload-item__step'} />
      ))}
    </span>
  );
}

function Sending({ item }: { item: UploadItem }) {
  const percent = item.sizeBytes === 0 ? 0 : Math.min(100, (item.loadedBytes / item.sizeBytes) * 100);
  const part = item.partsTotal === 0 ? '' : `part ${String(Math.min(item.partsDone + 1, item.partsTotal))} of ${String(item.partsTotal)}`;
  return (
    <>
      <span className="upload-item__head">
        <span className="upload-item__title">{titleOf(item, undefined)}</span>
        <span className="upload-item__mono">{part}</span>
      </span>
      <span className="upload-item__prog">
        <span className="upload-item__fill" style={{ width: `${String(percent)}%` }} />
      </span>
      <span className="upload-item__line">
        {`${item.resumed ? 'Resumed' : 'Uploading'} · ${formatBytes(item.loadedBytes)} of ${formatBytes(item.sizeBytes)}`}
      </span>
    </>
  );
}

function Processing({ item, clip }: { item: UploadItem; clip: ClipSummary | undefined }) {
  const isLive = clip !== undefined && isInProgress(clip.status);
  const event = useClipEvents(clip?.clip_id ?? item.id, isLive);
  if (clip?.status === 'ready') {
    const people = clip.people.length;
    return (
      <>
        <span className="upload-item__head">
          <span className="upload-item__title">{titleOf(item, clip)}</span>
          <span className="upload-item__ready">Ready</span>
        </span>
        <Dots done={INGEST_STAGES.length} tone="success" />
        <span className="upload-item__line">
          {`${String(clip.segment_count)} ${clip.segment_count === 1 ? 'moment' : 'moments'} · ${String(people)} ${people === 1 ? 'person' : 'people'} · searchable now`}
        </span>
      </>
    );
  }
  const stage = clip?.status === 'failed' ? { done: 0, text: 'Could not process this clip' } : ingestStage(event);
  return (
    <>
      <span className="upload-item__head">
        <span className="upload-item__title">{titleOf(item, clip)}</span>
        <span className="upload-item__state">Understanding</span>
      </span>
      <Dots done={stage.done} tone="accent" />
      <span className="upload-item__line">{stage.text}</span>
    </>
  );
}

/**
 * The card.
 * @param props - See `UploadItemCardProps`.
 * @returns The list item.
 */
export function UploadItemCard({ item, clip, onRetry }: UploadItemCardProps) {
  return (
    <li className={item.state === 'queued' ? 'upload-item upload-item--waiting' : 'upload-item'}>
      <span className="upload-item__thumb">{clip?.thumb_url != null && <img src={clip.thumb_url} alt="" />}</span>
      <span className="upload-item__body">
        {item.state === 'uploading' && <Sending item={item} />}
        {item.state === 'done' && <Processing item={item} clip={clip} />}
        {item.state === 'queued' && (
          <>
            <span className="upload-item__title">{titleOf(item, clip)}</span>
            <span className="upload-item__line">Waiting</span>
          </>
        )}
        {item.state === 'failed' && (
          <>
            <span className="upload-item__head">
              <span className="upload-item__title">{titleOf(item, clip)}</span>
              <span className="upload-item__problem">Paused</span>
            </span>
            <span className="upload-item__line">{`${formatBytes(item.loadedBytes)} of ${formatBytes(item.sizeBytes)} · ${item.errorMessage ?? 'Stopped'}`}</span>
          </>
        )}
      </span>
      {item.state === 'failed' && (
        <Button
          variant="secondary"
          onClick={() => {
            onRetry(item.id);
          }}
        >
          Retry
        </Button>
      )}
    </li>
  );
}
