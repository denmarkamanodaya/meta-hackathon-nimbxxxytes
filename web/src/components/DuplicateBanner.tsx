// Banner on the page of a duplicate clip: "Copy of ‹original›" linking to the original, and
// "Remove copy" behind a confirm sheet. Removing goes back to the Library, which reloads.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import { Spinner } from '../design/Spinner';
import { useClips, useRemoveClip } from '../hooks/useClips';
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
  const { remove, state: removing } = useRemoveClip();
  const [isConfirming, setConfirming] = useState(false);
  const original = state.status === 'ready' ? state.data.find((c) => c.clip_id === originalId) : undefined;
  const isRemoving = removing === 'removing';

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
      <Sheet
        open={isConfirming}
        onClose={() => {
          setConfirming(false);
        }}
        title="Remove this copy?"
      >
        <p className="duplicate-banner__confirm">Removes this copy and its files. The original stays.</p>
        <div className="duplicate-banner__actions">
          <Button
            size="lg"
            disabled={isRemoving}
            onClick={() => {
              void remove(clipId).then((isGone) => {
                if (!isGone) return;
                setConfirming(false);
                void navigate('/', { replace: true });
              });
            }}
          >
            {isRemoving ? (
              <>
                <Spinner />
                Removing…
              </>
            ) : (
              'Remove copy'
            )}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
