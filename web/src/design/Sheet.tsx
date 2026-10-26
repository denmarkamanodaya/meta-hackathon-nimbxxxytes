// Sheet primitive: a modal bottom sheet built on the native <dialog> (focus trap, Esc to close).
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './Button';
import './Sheet.css';

/** Props for `Sheet`. */
export interface SheetProps {
  /** Whether the sheet is shown. */
  open: boolean;
  /** Called when the user dismisses the sheet (Esc, backdrop tap or Close). */
  onClose: () => void;
  /** Heading shown at the top and used as the dialog's accessible name. */
  title: string;
  /** Sheet content. */
  children: ReactNode;
}

/**
 * Modal sheet that slides up from the bottom edge, inside the safe area.
 * @param props - See `SheetProps`.
 * @returns The dialog element.
 */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__panel">
        <div className="sheet__handle" aria-hidden="true" />
        <h2 id={titleId} className="sheet__title">
          {title}
        </h2>
        <div className="sheet__content">{children}</div>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </dialog>
  );
}
