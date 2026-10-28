// Edit text on the phone: a sheet with the step's title and instruction. Save sends only what
// changed (PATCH) and the server remakes that step's voice; the sheet closes once it is stored.
import { useId, useState } from 'react';
import { GUIDE_COPY, stepEdit } from '../core/guides';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import type { EditGuideStep } from '../hooks/useGuides';
import type { GuideStep } from '../services/api/types';
import { NameField } from './NameField';
import './NameField.css';
import './NamingSheet.css';

/** Props for `GuideEditSheet`. */
export interface GuideEditSheetProps {
  /** The step being edited; null keeps the sheet closed. */
  step: GuideStep | null;
  editor: EditGuideStep;
  onClose: () => void;
}

function Form({ step, editor, onClose }: GuideEditSheetProps & { step: GuideStep }) {
  const titleId = useId();
  const textId = useId();
  const [title, setTitle] = useState(step.title);
  const [instruction, setInstruction] = useState(step.instruction);
  const edit = stepEdit(step, { title, instruction });
  return (
    <form
      className="naming-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (edit === null) return;
        void editor.save(step.n, edit).then((isSaved) => {
          if (isSaved) onClose();
        });
      }}
    >
      <NameField id={titleId} label={GUIDE_COPY.stepTitleLabel} value={title} onChange={setTitle} />
      <div className="name-field">
        <label className="name-field__label" htmlFor={textId}>
          {GUIDE_COPY.instructionLabel}
        </label>
        <textarea
          id={textId}
          className="name-field__input"
          rows={3}
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
      </div>
      <Button type="submit" disabled={edit === null || editor.isSaving}>
        {editor.isSaving ? 'Saving…' : GUIDE_COPY.save}
      </Button>
    </form>
  );
}

/**
 * The sheet; the form remounts per step.
 * @param props - See `GuideEditSheetProps`.
 * @returns The sheet.
 */
export function GuideEditSheet(props: GuideEditSheetProps) {
  const { step, onClose } = props;
  return (
    <Sheet open={step !== null} onClose={onClose} title={step === null ? GUIDE_COPY.editTitle : `${GUIDE_COPY.editTitle} ${String(step.n)}`}>
      {step !== null && <Form key={step.n} {...props} step={step} />}
    </Sheet>
  );
}
