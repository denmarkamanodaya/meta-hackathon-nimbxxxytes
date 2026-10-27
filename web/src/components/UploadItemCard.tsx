// One file in the Upload queue (P6): while sending, its percentage (or "Waiting" until bytes move),
// a bar and "1.2 GB · about 2 min left"; before its turn, "Waiting" and "starts next"; once sent,
// the three steps (Uploading, Understanding, Ready) as a 3-part bar; when ready, what it found;
// after a failure, "Paused" and Retry.
import { isInProgress } from '../core/clip-view';
import { PROCESSING_STEPS, stepOfLine } from '../core/copy';
import { formatBytes } from '../core/format';
import { processingView } from '../core/processing-step';
import { itemLine, itemProgress } from '../core/upload-summary';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { StepBar } from '../design/StepBar';
import { useClipEvents } from '../hooks/useClips';
import type { ClipSummary } from '../services/api/types';
import type { UploadItem } from '../services/upload/queue';
import './UploadItemCard.css';

/** Props for `UploadItemCard`. */
export interface UploadItemCardProps {
  item: UploadItem;
  /** The clip this upload became, once the library lists it. */
  clip: ClipSummary | undefined;
  /** The first file still waiting for its turn ("starts next"). */
  isNext: boolean;
  onRetry: (id: string) => void;
}

const titleOf = (item: UploadItem, clip: ClipSummary | undefined) => clip?.title ?? item.name.replace(/\.[^.]+$/, '');

function Sending({ item, isNext }: { item: UploadItem; isNext: boolean }) {
  const percent = item.sizeBytes === 0 ? 0 : Math.min(100, (item.loadedBytes / item.sizeBytes) * 100);
  return (
    <>
      <span className="upload-item__head">
        <span className="upload-item__title">{titleOf(item, undefined)}</span>
        <span className={item.state === 'queued' ? 'upload-item__state' : 'upload-item__mono'}>
          {item.state === 'queued' ? 'Waiting' : itemProgress(item)}
        </span>
      </span>
      <span className="upload-item__prog">
        <span className="upload-item__fill" style={{ width: `${String(percent)}%` }} />
      </span>
      <span className="upload-item__line">{itemLine(item, isNext)}</span>
    </>
  );
}

function Processing({ item, clip }: { item: UploadItem; clip: ClipSummary | undefined }) {
  const isLive = clip !== undefined && isInProgress(clip.status);
  const event = useClipEvents(clip?.clip_id ?? item.id, isLive);
  // Sent but not listed yet: the server has the file, so it is past Uploading.
  const view = processingView(clip?.status ?? 'uploaded', event);
  if (view.kind !== 'step') {
    return (
      <span className="upload-item__head">
        <span className="upload-item__title">{titleOf(item, clip)}</span>
        <Chip tone={view.kind === 'failed' ? 'danger' : 'neutral'}>{view.label}</Chip>
      </span>
    );
  }
  const isReady = view.step === PROCESSING_STEPS.length && clip?.status === 'ready';
  const people = clip?.people.length ?? 0;
  const moments = clip?.segment_count ?? 0;
  return (
    <>
      <span className="upload-item__head">
        <span className="upload-item__title">{titleOf(item, clip)}</span>
        <Chip tone={isReady ? 'success' : 'accent'}>{view.label}</Chip>
      </span>
      <StepBar steps={PROCESSING_STEPS.length} current={view.step} within={view.within} tone="surface" />
      <span className="upload-item__line">
        {isReady
          ? `${String(moments)} ${moments === 1 ? 'moment' : 'moments'} · ${String(people)} ${people === 1 ? 'person' : 'people'} · searchable now`
          : `Uploaded. ${stepOfLine(view.step)}.`}
      </span>
    </>
  );
}

/**
 * The row.
 * @param props - See `UploadItemCardProps`.
 * @returns The list item.
 */
export function UploadItemCard({ item, clip, isNext, onRetry }: UploadItemCardProps) {
  return (
    <li className="upload-item">
      <span className="upload-item__thumb">{clip?.thumb_url != null && <img src={clip.thumb_url} alt="" />}</span>
      <span className="upload-item__body">
        {(item.state === 'uploading' || item.state === 'queued') && <Sending item={item} isNext={isNext} />}
        {item.state === 'done' && <Processing item={item} clip={clip} />}
        {item.state === 'failed' && (
          <>
            <span className="upload-item__head">
              <span className="upload-item__title">{titleOf(item, clip)}</span>
              <Chip tone="warning">Paused</Chip>
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
