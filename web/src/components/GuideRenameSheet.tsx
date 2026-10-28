// Rename on the phone: the naming sheet with the guide's title. Save sends the trimmed title and
// closes once it is stored; an unchanged, empty or too-long title keeps Save off and says why.
import { useId, useState } from 'react';
import { GUIDE_COPY, guideTitleProblem } from '../core/guides';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import type { RenameGuide } from '../hooks/useGuides';
import { NameField } from './NameField';
import './NamingSheet.css';

/** Props for `GuideRenameSheet`. */
export interface GuideRenameSheetProps {
  open: boolean;
  guideId: string;
  /** The current title. */
  title: string;
  renamer: RenameGuide;
  onClose: () => void;
}

function Form({ guideId, title, renamer, onClose }: Omit<GuideRenameSheetProps, 'open'>) {
  const fieldId = useId();
  const [value, setValue] = useState(title);
  const problem = guideTitleProblem(value);
  const isSame = value.trim() === title;
  return (
    <form
      className="naming-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem !== null || isSame) return;
        void renamer.rename(guideId, value.trim()).then((isSaved) => {
          if (isSaved) onClose();
        });
      }}
    >
      <NameField id={fieldId} label={GUIDE_COPY.titleField} value={value} onChange={setValue} />
      {problem !== null && (
        <p className="naming-sheet__problem" role="alert">
          {problem}
        </p>
      )}
      <Button type="submit" disabled={problem !== null || isSame || renamer.isSaving}>
        {renamer.isSaving ? 'Saving…' : GUIDE_COPY.save}
      </Button>
    </form>
  );
}

/**
 * The sheet; the form starts from the current title each time it opens.
 * @param props - See `GuideRenameSheetProps`.
 * @returns The sheet.
 */
export function GuideRenameSheet({ open, onClose, ...form }: GuideRenameSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={GUIDE_COPY.renameTitle}>
      {open && <Form {...form} onClose={onClose} />}
    </Sheet>
  );
}
