// Upload page: pick clips, watch each file upload, retry or resume after a dropped connection.
import { useState } from 'react';
import { FilePickerButton } from '../components/FilePickerButton';
import { UploadItemCard } from '../components/UploadItemCard';
import { Button } from '../design/Button';
import { Card } from '../design/Card';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Sheet } from '../design/Sheet';
import { isUploading, useUploads } from '../hooks/useUploads';
import './UploadPage.css';

const STEPS = [
  { title: 'Upload', body: 'Clips go from your phone straight to cloud storage, resuming if you lose signal.' },
  { title: 'Understand', body: 'Every scene gets a description, a transcript and the people in it.' },
  { title: 'Find and post', body: 'Search any moment, then let the editor cut it into a short.' },
] as const;

/**
 * Multi-file upload with per-file progress and a keep-screen-open notice while active.
 * @returns The page.
 */
export function UploadPage() {
  const { items, add, retry } = useUploads();
  const [isHelpOpen, setHelpOpen] = useState(false);
  const isActive = isUploading(items);

  return (
    <>
      <PageHeader
        title="Upload"
        trailing={
          <Button
            variant="ghost"
            aria-label="How it works"
            onClick={() => {
              setHelpOpen(true);
            }}
          >
            <Icon name="info" />
          </Button>
        }
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon="upload"
            title="Add clips from your glasses"
            body="Pick clips from your phone. Large files upload in parts, so nothing is lost."
            action={<FilePickerButton label="Choose clips" onPick={add} />}
          />
        </Card>
      ) : (
        <div className="upload-page__body">
          {isActive && (
            <div className="upload-page__notice" role="status">
              <Icon name="info" />
              <p>
                <strong>Keep this screen open.</strong> Uploads pause if you lock your phone or
                switch apps, and pick up where they left off when you come back.
              </p>
            </div>
          )}
          <ul className="upload-page__list">
            {items.map((item) => (
              <UploadItemCard key={item.id} item={item} onRetry={retry} />
            ))}
          </ul>
          <FilePickerButton label="Add more clips" onPick={add} />
        </div>
      )}
      <Sheet
        open={isHelpOpen}
        onClose={() => {
          setHelpOpen(false);
        }}
        title="How nimbytes works"
      >
        <ol className="upload-page__steps">
          {STEPS.map((step) => (
            <li key={step.title} className="upload-page__step">
              <strong className="upload-page__step-title">{step.title}</strong>
              {step.body}
            </li>
          ))}
        </ol>
      </Sheet>
    </>
  );
}
