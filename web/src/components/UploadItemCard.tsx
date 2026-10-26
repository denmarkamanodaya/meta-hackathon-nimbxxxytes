// One picked file in the upload list: name, state, progress, size and speed, retry on failure.
import { formatBytes, formatRate, percentOf } from '../core/format';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { ProgressBar } from '../design/ProgressBar';
import type { UploadItem } from '../services/upload/queue';
import './UploadItemCard.css';

const STATE_LABEL: Record<UploadItem['state'], string> = {
  queued: 'Waiting',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Paused',
};

const STATE_TONE = {
  queued: 'neutral',
  uploading: 'accent',
  done: 'success',
  failed: 'danger',
} as const;

function detail(item: UploadItem): string {
  const sizes = `${formatBytes(item.loadedBytes)} of ${formatBytes(item.sizeBytes)}`;
  if (item.state === 'done') return formatBytes(item.sizeBytes);
  if (item.state === 'failed') return `${sizes} · ${item.errorMessage ?? 'Stopped'}`;
  if (item.state === 'queued') return formatBytes(item.sizeBytes);
  const speed = item.bytesPerSecond === null ? '' : ` · ${formatRate(item.bytesPerSecond)}`;
  return `${sizes}${speed}${item.resumed ? ' · resumed' : ''}`;
}

/** Props for `UploadItemCard`. */
export interface UploadItemCardProps {
  /** The queue item to show. */
  item: UploadItem;
  /** Called when the user taps Retry on a failed item. */
  onRetry: (id: string) => void;
}

/**
 * Card for one upload.
 * @param props - See `UploadItemCardProps`.
 * @returns The list item.
 */
export function UploadItemCard({ item, onRetry }: UploadItemCardProps) {
  const percent = percentOf(item.loadedBytes, item.sizeBytes);
  const tone = item.state === 'failed' ? 'danger' : item.state === 'done' ? 'success' : 'accent';

  return (
    <li className="upload-item">
      <div className="upload-item__row">
        <span className="upload-item__name">{item.name}</span>
        <Chip tone={STATE_TONE[item.state]}>{STATE_LABEL[item.state]}</Chip>
      </div>
      <ProgressBar percent={percent} label={`${item.name} upload`} tone={tone} />
      <div className="upload-item__row">
        <span className="upload-item__detail">{detail(item)}</span>
        {item.state === 'failed' ? (
          <Button
            variant="ghost"
            onClick={() => {
              onRetry(item.id);
            }}
          >
            Retry
          </Button>
        ) : (
          <span className="upload-item__percent">{`${String(percent)}%`}</span>
        )}
      </div>
    </li>
  );
}
