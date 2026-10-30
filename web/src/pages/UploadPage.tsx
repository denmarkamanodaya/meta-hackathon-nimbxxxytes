// Upload (P6): "Upload" and its promise; while files go up, a warning banner that the one thing
// that stops an upload is closing nimbytes; the picker on top with the resume promise; then
// "Uploading 2 of 3" with bytes and time left over one card of files. A picked file already in the
// library waits in its own card: Skip (default) or Upload anyway. The picker takes photos too
// (mock PhotosMock): they go up through the photo queue, shown as "Uploading 12 photos".
import { FilePickerButton } from '../components/FilePickerButton';
import { PhotoUploadCard } from '../components/PhotoUploadCard';
import { StorageNotice } from '../components/StorageNotice';
import { UploadItemCard } from '../components/UploadItemCard';
import { splitPicked } from '../core/photos';
import { queueHeading, queueLeftLine, summarizeUploads } from '../core/upload-summary';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { useClips } from '../hooks/useClips';
import { useStorageCap } from '../hooks/useOverview';
import { useAddPhotos } from '../hooks/usePhotos';
import { isUploading, usePickWithCheck, useUploads, type HeldFile } from '../hooks/useUploads';
import type { UploadItem } from '../services/upload/queue';
import './UploadPage.css';

function QueueHead({ items }: { items: readonly UploadItem[] }) {
  const summary = summarizeUploads(items);
  return (
    <div className="upload-page__queue-head" role="status">
      <h2 className="upload-page__queue-title">{queueHeading(summary)}</h2>
      <span className="upload-page__left">{queueLeftLine(summary)}</span>
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
  const nextId = items.find((item) => item.state === 'queued')?.id;
  const cap = useStorageCap();
  const photos = useAddPhotos();

  return (
    <div className="upload-page">
      <PageHeader title="Upload" subtitle="Straight to your private cloud." />
      {isUploading(items) && (
        <p className="upload-page__banner" role="status">
          <Icon name="info" size="sm" />
          Keep nimbytes open until uploads finish. The screen stays awake for you.
        </p>
      )}
      <StorageNotice cap={cap} />
      <div className="upload-page__picker">
        <FilePickerButton
          label="Add clips and photos"
          variant="primary"
          accept="video/*,image/*"
          isDisabled={cap?.isFull === true}
          onPick={(files) => {
            const sorted = splitPicked(files);
            if (sorted.photos.length > 0) void photos.add(sorted.photos);
            if (sorted.videos.length > 0) void pick(sorted.videos);
          }}
        />
        <span className="upload-page__hint">Big files go up in parts. A dropped signal picks up where it stopped.</span>
      </div>
      <PhotoUploadCard />
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
      {items.length > 0 && (
        <section className="upload-page__queue" aria-label="Uploads">
          <QueueHead items={items} />
          <ul className="upload-page__card">
            {items.map((item) => (
              <UploadItemCard
                key={item.id}
                item={item}
                clip={item.clipId === null ? undefined : byId.get(item.clipId)}
                isNext={item.id === nextId}
                onRetry={retry}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
