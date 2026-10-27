// "Delete production…" (redesign v2, V10b), from the Productions list's ⋯ and the production
// page's ⋯: the confirm with "Also delete its short and renders", off by default. The checkbox is
// off and disabled for a production with no short yet.
import { useState } from 'react';
import { productionDeleteCopy } from '../../core/delete-copy';
import { hasStoryShort } from '../../core/production-view';
import { useDeleteProduction } from '../../hooks/useDelete';
import type { ProductionStatus } from '../../services/api/types';
import { MacConfirmCheck, MacConfirmDialog } from './MacConfirmDialog';

/** The production to delete. */
export interface ProductionToDelete {
  productionId: string;
  title: string;
  status: ProductionStatus;
  /** Its story short when the page knows it (null: none); left out, it is looked up on delete. */
  shortId?: string | null;
}

/** Props for `ProductionDeleteDialog`. */
export interface ProductionDeleteDialogProps {
  /** The production; null keeps the dialog closed. */
  target: ProductionToDelete | null;
  onCancel: () => void;
  /** After the production is gone (the toast is already shown). */
  onDeleted: () => void;
}

function Choice({ target, onCancel, onDeleted }: ProductionDeleteDialogProps & { target: ProductionToDelete }) {
  const deletion = useDeleteProduction();
  const [alsoShort, setAlsoShort] = useState(false);
  const hasShort = target.shortId === undefined ? hasStoryShort(target.status) : target.shortId !== null;
  return (
    <MacConfirmDialog
      open
      copy={productionDeleteCopy(target.title)}
      isBusy={deletion.isDeleting}
      onCancel={onCancel}
      onConfirm={() => {
        const { productionId, shortId } = target;
        void deletion
          .remove({ productionId, alsoShort: alsoShort && hasShort, ...(shortId === undefined ? {} : { shortId }) })
          .then((isDone) => {
            if (isDone) onDeleted();
          });
      }}
    >
      <MacConfirmCheck isChecked={alsoShort && hasShort} isDisabled={!hasShort} onChange={setAlsoShort} note="(otherwise the short stays in Shorts)">
        Also delete its short and renders
      </MacConfirmCheck>
    </MacConfirmDialog>
  );
}

/**
 * The dialog; each opening starts with the checkbox off.
 * @param props - See `ProductionDeleteDialogProps`.
 * @returns The dialog, or nothing while closed.
 */
export function ProductionDeleteDialog({ target, onCancel, onDeleted }: ProductionDeleteDialogProps) {
  if (target === null) return null;
  return <Choice key={target.productionId} target={target} onCancel={onCancel} onDeleted={onDeleted} />;
}
