// The Ask box's "Add a document…" (V47): pick one of your iRead letters, or upload a photo or PDF
// (it is added at once and read while you type). A centred modal dialog; Esc or a click outside
// closes it.
import { docKindLabel, docMetaLine, docTitle, IREAD_COPY } from '../../core/iread/documents';
import { Spinner } from '../../design/Spinner';
import { useAddDocument, useDocuments } from '../../hooks/useDocuments';
import { DocumentPicker } from '../DocumentPicker';
import { MacDialog } from './MacDialog';
import './NewProjectSheet.css';
import './AddClipsSheet.css';
import './AddDocumentSheet.css';

/** Props for `AddDocumentSheet`. */
export interface AddDocumentSheetProps {
  open: boolean;
  /** Gets the picked or uploaded document's id. */
  onPick: (documentId: string) => void;
  onClose: () => void;
}

function Picker({ onPick, onClose }: Omit<AddDocumentSheetProps, 'open'>) {
  const { state } = useDocuments();
  const { add, isAdding } = useAddDocument();
  const docs = state.status === 'ready' ? state.data.filter((doc) => doc.status !== 'failed') : [];
  return (
    <div className="new-project">
      <h2 className="new-project__title">{IREAD_COPY.pickTitle}</h2>
      {state.status === 'loading' && <p className="add-clips__empty">Loading your letters…</p>}
      {state.status === 'ready' && docs.length === 0 && <p className="add-clips__empty">{IREAD_COPY.pickEmpty}</p>}
      <ul className="add-clips__list">
        {docs.map((doc) => (
          <li key={doc.id}>
            <button
              type="button"
              className="add-clips__row add-doc__row"
              onClick={() => {
                onPick(doc.id);
              }}
            >
              <span className="add-clips__thumb">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" />}</span>
              <span className="add-doc__text">
                <span className="add-clips__name">{docTitle(doc)}</span>
                <span className="add-clips__date">{docMetaLine(doc, true)}</span>
              </span>
              <span className="add-clips__date">{docKindLabel(doc.kind)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          Cancel
        </button>
        <DocumentPicker
          pick="any"
          className="mac-button new-project__create"
          isDisabled={isAdding}
          onFile={(file) => {
            void add(file).then((id) => {
              if (id !== null) onPick(id);
            });
          }}
        >
          {isAdding ? (
            <>
              <Spinner />
              {IREAD_COPY.uploading}
            </>
          ) : (
            IREAD_COPY.uploadDocument
          )}
        </DocumentPicker>
      </div>
    </div>
  );
}

/**
 * The dialog.
 * @param props - See `AddDocumentSheetProps`.
 * @returns The dialog.
 */
export function AddDocumentSheet({ open, onPick, onClose }: AddDocumentSheetProps) {
  return (
    <MacDialog open={open} label={IREAD_COPY.addDocument} onClose={onClose}>
      {open && <Picker onPick={onPick} onClose={onClose} />}
    </MacDialog>
  );
}
