// Delete guide on the phone: the shared confirm sheet with the guide's words. Deleting opens the
// Guides list in place of the guide.
import { GUIDE_DELETE_COPY } from '../core/delete-copy';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { useDeleteGuide } from '../hooks/useGuides';

/** Props for `GuideDeleteSheet`. */
export interface GuideDeleteSheetProps {
  open: boolean;
  guideId: string;
  onCancel: () => void;
}

/**
 * The sheet.
 * @param props - See `GuideDeleteSheetProps`.
 * @returns The confirm sheet.
 */
export function GuideDeleteSheet({ open, guideId, onCancel }: GuideDeleteSheetProps) {
  const { remove, isDeleting } = useDeleteGuide();
  return (
    <ConfirmSheet
      open={open}
      title={GUIDE_DELETE_COPY.title}
      body={GUIDE_DELETE_COPY.body}
      confirmLabel={GUIDE_DELETE_COPY.confirmLabel}
      busyLabel="Deleting…"
      isBusy={isDeleting}
      onConfirm={() => {
        void remove(guideId);
      }}
      onCancel={onCancel}
    />
  );
}
