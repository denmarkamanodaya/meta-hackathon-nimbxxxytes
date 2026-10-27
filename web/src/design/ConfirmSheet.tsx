// Confirm sheet for a destructive action (mocks V3/V4): the question as the title, what will be
// removed, a red confirm button and Cancel. Used by every delete: clip, short, several clips and
// a duplicate copy, each with its own words.
import { useEffect, useRef } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { Spinner } from './Spinner';
import './ConfirmSheet.css';

/** Props for `ConfirmSheet`. */
export interface ConfirmSheetProps {
  open: boolean;
  /** The question ("Delete this clip?"). */
  title: string;
  /** What goes and what stays. */
  body: string;
  /** Confirm button label ("Delete clip"). */
  confirmLabel: string;
  /** Label while the action runs ("Deleting…"). */
  busyLabel: string;
  /** True while the action runs: the confirm button spins and both buttons are disabled. */
  isBusy: boolean;
  onConfirm: () => void;
  /** Cancel, Esc or a backdrop tap. */
  onCancel: () => void;
}

/**
 * The sheet.
 * @param props - See `ConfirmSheetProps`.
 * @returns The dialog.
 */
export function ConfirmSheet({ open, title, body, confirmLabel, busyLabel, isBusy, onConfirm, onCancel }: ConfirmSheetProps) {
  const cancel = useRef<HTMLButtonElement>(null);
  // Cancel takes the first focus (after the dialog opens and focuses its first button), so Enter
  // or Space never deletes by accident.
  useEffect(() => {
    if (open) cancel.current?.focus();
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="confirm-sheet__actions">
          <Button variant="danger" size="lg" disabled={isBusy} onClick={onConfirm}>
            {isBusy ? (
              <>
                <Spinner />
                {busyLabel}
              </>
            ) : (
              confirmLabel
            )}
          </Button>
          <Button ref={cancel} variant="secondary" size="lg" disabled={isBusy} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
    >
      <p className="confirm-sheet__body">{body}</p>
    </Sheet>
  );
}
