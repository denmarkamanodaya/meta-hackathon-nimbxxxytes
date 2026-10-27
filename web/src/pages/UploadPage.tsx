// Upload (Mist): "Upload" and its promise, a dark summary card (files sent, bytes and time
// left, the resume promise), one card per file, and "Add clips from Photos" above the tab bar.
// A picked file already in the library waits in its own card: Skip (default) or Upload anyway.
import { FilePickerButton } from '../components/FilePickerButton';
import { UploadItemCard } from '../components/UploadItemCard';
import { formatBytes } from '../core/format';
import { formatTimeLeft, summarizeUploads } from '../core/upload-summary';
import { Button } from '../design/Button';
import { PageHeader } from '../design/PageHeader';
import { useClips } from '../hooks/useClips';
import { usePickWithCheck, useUploads, type HeldFile } from '../hooks/useUploads';
import type { UploadItem } from '../services/upload/queue';
import './UploadPage.css';

function Summary({ items }: { items: readonly UploadItem[] }) {
  const summary = summarizeUploads(items);
  const left = summary.bytesLeft > 0 ? `${formatBytes(summary.bytesLeft)} left` : 'all sent';
  const time = formatTimeLeft(summary.secondsLeft);
  return (
    <div className="upload-page__summary" role="status">
      <div className="upload-page__summary-head">
        <span className="upload-page__sent">{`${String(summary.sent)} of ${String(summary.total)} sent`}</span>
        <span className="upload-page__left">{time === '' ? left : `${left} · ${time}`}</span>
      </div>
      <div className="upload-page__bar">
        <span className="upload-page__bar-fill" style={{ width: `${String(Math.round(summary.fraction * 100))}%` }} />
      </div>
      <span className="upload-page__resume">Lost signal? It picks up where it stopped.</span>
    </div>
  );
}

function HeldCard({ held, onSkip, onUpload }: { held: HeldFile; onSkip: () => void; onUpload: () => void }) {
  return (
    <li className="upload-page__held" aria-label={`${held.file.name} is already in your library`}>
      <span className="upload-page__held-text">
        <span className="upload-page__held-title">{held.file.name}</span>
        <span className="upload-page__held-line">{`Already in your library: ${held.title}`}</span>
      </span>
      <span className="upload-page__held-actions">
        <Button onClick={onSkip}>Skip</Button>
        <Button variant="secondary" onClick={onUpload}>
          Upload anyway
        </Button>
      </span>
    </li>
  );
}

/**
 * Multi-file upload with per-file progress, processing and readiness.
 * @returns The page.
 */
export function UploadPage() {
  const { items, retry } = useUploads();
  const { held, pick, skip, uploadAnyway } = usePickWithCheck();
  const clips = useClips();
  const byId = new Map((clips.state.status === 'ready' ? clips.state.data : []).map((clip) => [clip.clip_id, clip]));

  return (
    <div className="upload-page">
      <PageHeader title="Upload" subtitle="Straight to your private cloud. Keep this screen open." />
      {held.length > 0 && (
        <ul className="upload-page__list">
          {held.map((h) => (
            <HeldCard
              key={h.id}
              held={h}
              onSkip={() => {
                skip(h.id);
              }}
              onUpload={() => {
                uploadAnyway(h.id);
              }}
            />
          ))}
        </ul>
      )}
      {items.length > 0 ? (
        <>
          <Summary items={items} />
          <ul className="upload-page__list">
            {items.map((item) => (
              <UploadItemCard key={item.id} item={item} clip={item.clipId === null ? undefined : byId.get(item.clipId)} onRetry={retry} />
            ))}
          </ul>
        </>
      ) : held.length > 0 ? null : (
        <p className="upload-page__empty">Pick clips from your phone. Large files go up in parts, so a dropped signal never starts them over.</p>
      )}
      <div className="upload-page__add">
        <FilePickerButton
          label="Add clips from Photos"
          onPick={(files) => {
            void pick(files);
          }}
        />
      </div>
    </div>
  );
}
