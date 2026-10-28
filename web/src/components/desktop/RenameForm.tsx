// The rename sheets' form on the Mac (the New project sheet's frame with one text field): the
// heading, the field with the current value, what is wrong with the new one, and Cancel / Rename.
// ⏎ saves; the sheet around it (a `MacDialog`) closes on Esc or a click outside. Save sends the
// trimmed value and closes once it is stored; an unchanged or invalid value keeps Rename off.
// Projects and productions both rename through it, each inside its own sheet so its data loads
// only while the sheet is open.
import { useId, useState } from 'react';
import './MacColumns.css';
import './NewProjectSheet.css';

/** Props for `RenameForm`. */
export interface RenameFormProps {
  /** The sheet's heading ("Rename project"). */
  heading: string;
  /** The field's label ("Name"). */
  label: string;
  /** The current value. */
  initial: string;
  /** What is wrong with a value, or null when it may be saved. */
  problemOf: (value: string) => string | null;
  isSaving: boolean;
  /** Stores the trimmed value; resolves true once it is stored (the sheet then closes). */
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * The form.
 * @param props - See `RenameFormProps`.
 * @returns The form element.
 */
export function RenameForm({ heading, label, initial, problemOf, isSaving, onSave, onClose }: RenameFormProps) {
  const titleId = useId();
  const [value, setValue] = useState(initial);
  const problem = problemOf(value);
  const isSame = value.trim() === initial;
  return (
    <form
      className="new-project"
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem !== null || isSame) return;
        void onSave(value.trim()).then((saved) => {
          if (saved) onClose();
        });
      }}
    >
      <h2 id={titleId} className="new-project__title">
        {heading}
      </h2>
      <label className="new-project__field">
        {label}
        <input
          className="new-project__input"
          type="text"
          value={value}
          autoFocus
          aria-invalid={problem !== null}
          onChange={(event) => {
            setValue(event.target.value);
          }}
        />
        {problem !== null && (
          <span className="new-project__problem" role="alert">
            {problem}
          </span>
        )}
      </label>
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="mac-button new-project__create" disabled={problem !== null || isSame || isSaving}>
          {isSaving ? 'Saving…' : 'Rename'}
        </button>
      </div>
    </form>
  );
}
