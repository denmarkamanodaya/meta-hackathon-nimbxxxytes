// A centred Mac sheet (redesign v2, the New project sheet's frame): the native modal <dialog>
// (focus trap, Esc closes), closed by a click outside too. The content mounts only while open, so
// each opening starts fresh.
import { useEffect, useRef, type ReactNode } from 'react';
import './NewProjectSheet.css';

/** Props for `MacDialog`. */
export interface MacDialogProps {
  open: boolean;
  /** Accessible name. */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The dialog.
 * @param props - See `MacDialogProps`.
 * @returns The dialog element.
 */
export function MacDialog({ open, label, onClose, children }: MacDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="new-project-dialog"
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}
