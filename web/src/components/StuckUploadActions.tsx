// A letter whose upload never finished (`isUploadStuck`): Try again re-picks the file and adds it
// afresh, then deletes the stuck letter; Delete removes it (it has no file, so there is nothing
// to confirm). A failure shows under the buttons as well as in its toast. Shared by the phone and
// Mac letter pages and the lists; each passes its own button styles.
import { IREAD_COPY } from '../core/iread/documents';
import { useDeleteDocument, useRetryUpload } from '../hooks/useDocuments';
import { DocumentPicker } from './DocumentPicker';

/** Props for `StuckUploadActions`. */
export interface StuckUploadActionsProps {
  documentId: string;
  /** Gets the new letter's id after Try again. */
  onReplaced: (documentId: string) => void;
  /** Called after Delete. */
  onDeleted: () => void;
  /** Try again's class (the surface's primary button). */
  retryClassName: string;
  /** Delete's class. */
  deleteClassName: string;
  /** The failure line's class. */
  errorClassName: string;
}

/**
 * Try again and Delete.
 * @param props - See `StuckUploadActionsProps`.
 * @returns The two buttons and the last failure.
 */
export function StuckUploadActions({ documentId, onReplaced, onDeleted, retryClassName, deleteClassName, errorClassName }: StuckUploadActionsProps) {
  const { retry, isAdding, error } = useRetryUpload();
  const { remove, isDeleting } = useDeleteDocument();
  const isBusy = isAdding || isDeleting;
  return (
    <>
      <DocumentPicker
        pick="any"
        className={retryClassName}
        isDisabled={isBusy}
        onFile={(file) => {
          void retry(documentId, file).then((id) => {
            if (id !== null) onReplaced(id);
          });
        }}
      >
        {isAdding ? IREAD_COPY.uploading : IREAD_COPY.tryAgain}
      </DocumentPicker>
      <button
        type="button"
        className={deleteClassName}
        disabled={isBusy}
        onClick={() => {
          void remove(documentId).then((isDone) => {
            if (isDone) onDeleted();
          });
        }}
      >
        {isDeleting ? 'Deleting…' : IREAD_COPY.deleteStuck}
      </button>
      {error !== null && (
        <span className={errorClassName} role="alert">
          {error}
        </span>
      )}
    </>
  );
}
