// The phone clip page's near-copy and same-moment boxes (Phase 29, the Mac right column's V52–V53
// boxes in the phone's buttons): "Looks like a copy" with Remove this copy (behind the confirm
// sheet) and Keep both, "2 angles of this moment", or on the original "1 copy of this clip".
import { useState } from 'react';
import { copiedByLine, originalOf, removeCopiesCopy, removingLabel, sameMomentLinks } from '../core/similar';
import { buttonClassName } from '../design/Button';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { useKeepClip, useRemoveCopies } from '../hooks/useSimilar';
import type { ClipDetail } from '../services/api/types';
import { AnglesBox, CopiedByLine, CopyBox } from './ClipSimilar';

/** Props for `ClipSimilarNotes`. */
export interface ClipSimilarNotesProps {
  detail: ClipDetail;
  /** After Keep both: reload the clip. */
  onKept: () => void;
  /** After the copy is removed: leave the page. */
  onRemoved: () => void;
}

/**
 * The boxes, or nothing for a plain clip.
 * @param props - See `ClipSimilarNotesProps`.
 * @returns The boxes and the confirm sheet.
 */
export function ClipSimilarNotes({ detail, onKept, onRemoved }: ClipSimilarNotesProps) {
  const { clip, links } = detail;
  const original = originalOf(clip, links);
  const angles = sameMomentLinks(links);
  const keeping = useKeepClip();
  const removal = useRemoveCopies();
  const [isConfirming, setConfirming] = useState(false);
  if (original === null && angles.length === 0 && copiedByLine(links) === null) return null;
  const copy = removeCopiesCopy(1);
  return (
    <>
      {original !== null && (
        <CopyBox
          clip={clip}
          original={original}
          isBusy={keeping.isKeeping || removal.progress !== null}
          buttonClass={buttonClassName('secondary')}
          primaryClass={buttonClassName('primary')}
          onRemove={() => {
            setConfirming(true);
          }}
          onKeep={() => {
            void keeping.keep(clip.clip_id).then((ok) => {
              if (ok) onKept();
            });
          }}
        />
      )}
      {original === null && angles.length > 0 && <AnglesBox clip={clip} links={angles} />}
      <CopiedByLine links={links} />
      <ConfirmSheet
        open={isConfirming}
        title={copy.title}
        body={copy.body}
        confirmLabel={copy.confirmLabel}
        busyLabel={removal.progress === null ? 'Removing…' : removingLabel(removal.progress)}
        isBusy={removal.progress !== null}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void removal.remove([clip.clip_id]).then((outcome) => {
            setConfirming(false);
            if (outcome.failed.length === 0) onRemoved();
          });
        }}
      />
    </>
  );
}
