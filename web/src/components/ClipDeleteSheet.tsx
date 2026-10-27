// The confirm sheet for deleting one clip or several (mock V3): deletes them one at a time on the
// red button, toasts how it went ("Clip deleted", "Could not delete 1 of 3 clips") and hands the
// outcome back so the page can leave or refresh.
import { clipDeleteToast, type DeleteOutcome } from '../core/bulk-delete';
import { clipDeleteCopy } from '../core/delete-copy';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { useDeleteClips } from '../hooks/useDelete';
import { useServices } from '../hooks/services-context';

/** A clip to delete. */
export interface DeleteTarget {
  clipId: string;
  title: string;
}

/** Props for `ClipDeleteSheet`. */
export interface ClipDeleteSheetProps {
  /** The clips; empty keeps the sheet closed. */
  targets: readonly DeleteTarget[];
  onCancel: () => void;
  /** After the run, whatever it did. */
  onDone: (outcome: DeleteOutcome) => void;
}

/**
 * The sheet.
 * @param props - See `ClipDeleteSheetProps`.
 * @returns The dialog.
 */
export function ClipDeleteSheet({ targets, onCancel, onDone }: ClipDeleteSheetProps) {
  const { toasts } = useServices();
  const deletion = useDeleteClips();
  const copy = clipDeleteCopy(targets.length === 0 ? [''] : targets.map((target) => target.title));
  return (
    <ConfirmSheet
      open={targets.length > 0}
      title={copy.title}
      body={copy.body}
      confirmLabel={copy.confirmLabel}
      busyLabel="Deleting…"
      isBusy={deletion.isDeleting}
      onCancel={onCancel}
      onConfirm={() => {
        void deletion.run(targets.map((target) => target.clipId)).then((outcome) => {
          const toast = clipDeleteToast(outcome);
          if (toast.tone === 'info') toasts.info(toast.title, '');
          else toasts.error(toast.title, toast.error);
          onDone(outcome);
        });
      }}
    />
  );
}
