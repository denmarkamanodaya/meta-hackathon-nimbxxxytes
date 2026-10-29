// A Mac confirm dialog for a delete (redesign v2, V10b): the question, what goes and what stays,
// an optional choice (a checkbox) and Cancel / the red button. Cancel takes the first focus, so
// Enter never deletes by accident; Esc or a click outside cancels.
import type { ReactNode } from 'react';
import type { DeleteCopy } from '../../core/delete-copy';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './MacConfirmDialog.css';

/** Props for `MacConfirmDialog`. */
export interface MacConfirmDialogProps {
  open: boolean;
  /** Title, body and the red button's label. */
  copy: DeleteCopy;
  /** Extra controls under the body (the "Also delete its short" checkbox). */
  children?: ReactNode;
  /** True while the delete runs: the buttons are disabled and the red one says so. */
  isBusy: boolean;
  /** The red button's words while it runs; default "Deleting…". */
  busyLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function Body({ copy, children, isBusy, busyLabel = 'Deleting…', onConfirm, onCancel }: Omit<MacConfirmDialogProps, 'open'>) {
  return (
    <div className="mac-confirm">
      <h2 className="mac-confirm__title">
        {copy.title}
      </h2>
      <p className="mac-confirm__body">{copy.body}</p>
      {children}
      <div className="mac-confirm__actions">
        <button type="button" className="mac-button mac-button--quiet mac-confirm__button" autoFocus disabled={isBusy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="mac-button mac-confirm__button mac-confirm__danger" disabled={isBusy} onClick={onConfirm}>
          {isBusy ? busyLabel : copy.confirmLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * The dialog.
 * @param props - See `MacConfirmDialogProps`.
 * @returns The modal dialog.
 */
export function MacConfirmDialog({ open, onCancel, ...rest }: MacConfirmDialogProps) {
  return (
    <MacDialog open={open} label={rest.copy.title} onClose={onCancel}>
      <Body {...rest} onCancel={onCancel} />
    </MacDialog>
  );
}

/**
 * A checkbox line in the dialog: "Also delete its short and renders (otherwise …)".
 * @param props - Checked state, its setter, the line and the muted note after it.
 * @returns The label.
 */
export function MacConfirmCheck({
  isChecked,
  onChange,
  isDisabled = false,
  children,
  note,
}: {
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
  isDisabled?: boolean;
  children: ReactNode;
  note: string;
}) {
  return (
    <label className="mac-confirm__check">
      <input
        type="checkbox"
        checked={isChecked}
        disabled={isDisabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
      <span>
        {children} <span className="mac-confirm__note">{note}</span>
      </span>
    </label>
  );
}
