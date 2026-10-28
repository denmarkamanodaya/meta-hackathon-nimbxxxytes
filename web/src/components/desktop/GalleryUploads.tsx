// Uploading straight from the Mac Gallery (redesign v2, Upload picker and Uploading boards): the
// split Upload button ("Upload" opens the native file dialog, "▾" offers "Upload a folder…"), the
// header pill "Uploading 2 clips · 1.1 of 2.3 GB · about 3 min left", and each upload as a dashed
// tile first in the grid or a row at the top of the list, with its state, a cancel × and a bar.
import type { CapView } from '../../core/storage';
import type { UploadRowSpans } from '../../core/gallery-list';
import type { GalleryUpload } from '../../core/gallery-uploads';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Spinner } from '../../design/Spinner';
import { usePickAndUpload } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import './GalleryUploads.css';

/**
 * Upload and its ▾ menu; both are disabled, saying why, while the account is full.
 * @param props - The storage cap, or null while it loads.
 * @returns The split button.
 */
export function UploadSplitButton({ cap }: { cap: CapView | null }) {
  const { pick, pickFolder, isPicking } = usePickAndUpload();
  const menu = useMenu();
  const isFull = cap?.isFull === true;
  const isOff = isFull || isPicking;
  return (
    <span className="upload-split" title={isFull ? (cap.notice ?? undefined) : undefined}>
      <button
        type="button"
        className="upload-split__main"
        aria-label="Upload clips"
        disabled={isOff}
        onClick={() => {
          void pick();
        }}
      >
        <Icon name="upload" size="xs" />
        Upload
      </button>
      <button
        type="button"
        className="upload-split__caret"
        aria-label="Upload a folder"
        aria-haspopup="menu"
        disabled={isOff}
        onClick={menu.openFromButton}
      >
        <Icon name="chevron-down" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label="Upload"
        onClose={menu.close}
        items={[
          {
            kind: 'item',
            label: 'Upload a folder…',
            icon: 'folder',
            onSelect: () => {
              void pickFolder();
            },
          },
        ]}
      />
    </span>
  );
}

/**
 * The header pill.
 * @param props - The line from `uploadingLine`.
 * @returns The pill.
 */
export function UploadingPill({ line }: { line: string }) {
  return (
    <span className="upload-pill" role="status">
      <Spinner />
      {line}
    </span>
  );
}

function Bar({ upload }: { upload: GalleryUpload }) {
  return (
    <span
      className="upload-bar"
      role="progressbar"
      aria-label={upload.name}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={upload.percent}
    >
      <span
        className={upload.state === 'failed' ? 'upload-bar__fill upload-bar__fill--failed' : 'upload-bar__fill'}
        style={{ width: `${String(upload.percent)}%` }}
      />
    </span>
  );
}

function CancelButton({ upload, onCancel, className }: { upload: GalleryUpload; onCancel: (transferId: string) => void; className: string }) {
  const { cancelId } = upload;
  if (cancelId === null) return null;
  return (
    <button
      type="button"
      className={`upload-cancel ${className}`}
      aria-label={`Cancel uploading ${upload.name}`}
      title="Cancel upload"
      onClick={() => {
        onCancel(cancelId);
      }}
    >
      <Icon name="close" size="xs" />
    </button>
  );
}

const stateClass = (upload: GalleryUpload) =>
  upload.state === 'failed' ? 'upload-state upload-state--failed' : 'upload-state';

/**
 * One upload in the grid.
 * @param props - The upload and the cancel action.
 * @returns The grid item.
 */
export function UploadTile({ upload, onCancel }: { upload: GalleryUpload; onCancel: (transferId: string) => void }) {
  return (
    <li className="mac-clip-tile">
      <span className="upload-tile" title={upload.error ?? undefined}>
        <span className={`upload-tile__center ${stateClass(upload)}`}>
          <Icon name="upload" size="md" />
          {upload.label}
        </span>
        <CancelButton upload={upload} onCancel={onCancel} className="upload-tile__cancel" />
        <span className="upload-tile__bar">
          <Bar upload={upload} />
        </span>
      </span>
      <span className="mac-clip-tile__caption">{upload.name}</span>
      <span className="mac-clip-tile__sub">{upload.size}</span>
    </li>
  );
}

/**
 * One upload in the list: a dashed thumbnail, the name, the state and bar under Recorded and
 * Length (Length alone on a narrow window), the size when Size shows, and cancel at the end.
 * @param props - The upload, how its cells span the shown columns, and the cancel action.
 * @returns The table row.
 */
export function UploadRow({ upload, spans, onCancel }: { upload: GalleryUpload; spans: UploadRowSpans; onCancel: (transferId: string) => void }) {
  return (
    <tr className="gallery-list__row" title={upload.error ?? undefined}>
      <td>
        <span className="gallery-list__thumb upload-row__thumb">
          <Icon name="upload" size="xs" />
        </span>
      </td>
      <td className="gallery-list__name">{upload.name}</td>
      <td colSpan={spans.progress}>
        <span className="upload-row__progress">
          <span className={stateClass(upload)}>{upload.label}</span>
          <Bar upload={upload} />
        </span>
      </td>
      {spans.hasSize && <td>{upload.size}</td>}
      <td colSpan={spans.end} className="upload-row__end">
        <CancelButton upload={upload} onCancel={onCancel} className="upload-row__cancel" />
      </td>
    </tr>
  );
}
