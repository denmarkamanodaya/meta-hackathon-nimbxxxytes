// Rename on the phone: the naming sheet with the current title. Save sends the trimmed title and
// closes once it is stored; an unchanged, empty or too-long title keeps Save off and says why.
// An iGuide and an iRead letter rename through it, each with its own words and title rule.
import { useId, useState } from 'react';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import { NameField } from './NameField';
import './NamingSheet.css';

/** Props for `RenameSheet`. */
export interface RenameSheetProps {
  open: boolean;
  /** The sheet's title ("Rename iGuide"). */
  heading: string;
  /** The field's label. */
  label: string;
  /** The Save button's words. */
  saveLabel: string;
  /** The current title. */
  title: string;
  /** What is wrong with a typed title, or null when it may be saved. */
  problemOf: (value: string) => string | null;
  isSaving: boolean;
  /** Stores the trimmed title; resolves true once stored. */
  onSave: (title: string) => Promise<boolean>;
  onClose: () => void;
}

function Form({ label, saveLabel, title, problemOf, isSaving, onSave, onClose }: Omit<RenameSheetProps, 'open' | 'heading'>) {
  const fieldId = useId();
  const [value, setValue] = useState(title);
  const problem = problemOf(value);
  const isSame = value.trim() === title;
  return (
    <form
      className="naming-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem !== null || isSame) return;
        void onSave(value.trim()).then((isSaved) => {
          if (isSaved) onClose();
        });
      }}
    >
      <NameField id={fieldId} label={label} value={value} onChange={setValue} />
      {problem !== null && (
        <p className="naming-sheet__problem" role="alert">
          {problem}
        </p>
      )}
      <Button type="submit" disabled={problem !== null || isSame || isSaving}>
        {isSaving ? 'Saving…' : saveLabel}
      </Button>
    </form>
  );
}

/**
 * The sheet; the form starts from the current title each time it opens.
 * @param props - See `RenameSheetProps`.
 * @returns The sheet.
 */
export function RenameSheet({ open, heading, onClose, ...form }: RenameSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={heading}>
      {open && <Form {...form} onClose={onClose} />}
    </Sheet>
  );
}
