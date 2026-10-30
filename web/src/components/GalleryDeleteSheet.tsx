// The confirm for deleting Gallery entries of any kind (the Select bar's Delete, and a recording's
// or a document's ⋯ in the Gallery): deletes them one at a time on the red button, toasts how it
// went ("3 items deleted", "Could not delete 1 of 3 items") and hands the outcome back so the page
// can refresh. The Gallery stays open (the iListen and iRead pages' own deletes leave for their list).
import type { DeleteOutcome } from '../core/bulk-delete';
import { itemsDeleteCopy, itemsDeleteToast } from '../core/gallery-items';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { useDeleteGalleryItems } from '../hooks/useDelete';
import { useServices } from '../hooks/services-context';

/** Props for `GalleryDeleteSheet`. */
export interface GalleryDeleteSheetProps {
  /** Gallery ids; empty keeps the sheet closed. */
  itemIds: readonly string[];
  onCancel: () => void;
  onDone: (outcome: DeleteOutcome) => void;
}

/**
 * The sheet.
 * @param props - See `GalleryDeleteSheetProps`.
 * @returns The dialog.
 */
export function GalleryDeleteSheet({ itemIds, onCancel, onDone }: GalleryDeleteSheetProps) {
  const { toasts } = useServices();
  const deletion = useDeleteGalleryItems();
  const copy = itemsDeleteCopy(Math.max(1, itemIds.length));
  return (
    <ConfirmSheet
      open={itemIds.length > 0}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      busyLabel="Deleting…"
      isBusy={deletion.isDeleting}
      onCancel={onCancel}
      onConfirm={() => {
        void deletion.run(itemIds).then((outcome) => {
          const toast = itemsDeleteToast(outcome);
          if (toast.tone === 'info') toasts.info(toast.title, '');
          else toasts.error(toast.title, toast.error);
          onDone(outcome);
        });
      }}
    />
  );
}
