// Banner on the page of a duplicate clip: "Copy of ‹original›" linking to the original, and
// "Remove copy" behind a confirm sheet. Removing goes back to the Library, which reloads.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../design/Button';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { useClips } from '../hooks/useClips';
import { useDeleteClips } from '../hooks/useDelete';
import { useServices } from '../hooks/services-context';
import './DuplicateBanner.css';

/** Props for `DuplicateBanner`. */
export interface DuplicateBannerProps {
  /** The duplicate shown on this page. */
  clipId: string;
  /** The clip it copies. */
  originalId: string;
}

/**
 * The banner and its confirm sheet.
 * @param props - See `DuplicateBannerProps`.
 * @returns The banner.
 */
export function DuplicateBanner({ clipId, originalId }: DuplicateBannerProps) {
  const navigate = useNavigate();
  const { state } = useClips();
  const { toasts } = useServices();
  const removal = useDeleteClips();
  const [isConfirming, setConfirming] = useState(false);
  const original = state.status === 'ready' ? state.data.find((c) => c.clip_id === originalId) : undefined;

  return (
    <div className="duplicate-banner" role="note">
      <p className="duplicate-banner__text">
        Copy of{' '}
        <Link className="duplicate-banner__link" to={`/clips/${encodeURIComponent(originalId)}`}>
          {original?.title ?? 'a clip in your library'}
        </Link>
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Remove copy
      </Button>
      <ConfirmSheet
        open={isConfirming}
        title="Remove this copy?"
        body="Removes this copy and its files. The original stays."
        confirmLabel="Remove copy"
        busyLabel="Removing…"
        isBusy={removal.isDeleting}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void removal.run([clipId]).then((outcome) => {
            if (outcome.failed.length > 0) {
              toasts.error('Could not remove this copy', outcome.firstError);
              return;
            }
            setConfirming(false);
            void navigate('/', { replace: true });
          });
        }}
      />
    </div>
  );
}
