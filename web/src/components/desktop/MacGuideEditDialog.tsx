// Edit text on the Mac (V34): the New project sheet's frame with the step's title and its
// instruction. Save sends only what changed (PATCH) and closes once it is stored; the server
// remakes that step's voice.
import { useId, useState } from 'react';
import { GUIDE_COPY, stepEdit } from '../../core/guides';
import type { EditGuideStep } from '../../hooks/useGuides';
import type { GuideStep } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './NewProjectSheet.css';
import './MacGuideDialogs.css';

/** Props for `MacGuideEditDialog`. */
export interface MacGuideEditDialogProps {
  /** The step being edited; null keeps the dialog closed. */
  step: GuideStep | null;
  editor: EditGuideStep;
  onClose: () => void;
}

function Form({ step, editor, onClose }: MacGuideEditDialogProps & { step: GuideStep }) {
  const headingId = useId();
  const [title, setTitle] = useState(step.title);
  const [instruction, setInstruction] = useState(step.instruction);
  const edit = stepEdit(step, { title, instruction });
  return (
    <form
      className="new-project"
      aria-labelledby={headingId}
      onSubmit={(event) => {
        event.preventDefault();
        if (edit === null) return;
        void editor.save(step.n, edit).then((isSaved) => {
          if (isSaved) onClose();
        });
      }}
    >
      <h2 id={headingId} className="new-project__title">
        {`${GUIDE_COPY.editTitle} ${String(step.n)}`}
      </h2>
      <label className="new-project__field">
        {GUIDE_COPY.stepTitleLabel}
        <input
          className="new-project__input"
          type="text"
          value={title}
          autoFocus
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </label>
      <label className="new-project__field">
        {GUIDE_COPY.instructionLabel}
        <textarea
          className="new-project__input mac-guide-dialog__textarea"
          rows={3}
          value={instruction}
          onChange={(event) => {
            setInstruction(event.target.value);
          }}
        />
      </label>
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          {GUIDE_COPY.cancel}
        </button>
        <button type="submit" className="mac-button new-project__create" disabled={edit === null || editor.isSaving}>
          {editor.isSaving ? 'Saving…' : GUIDE_COPY.save}
        </button>
      </div>
    </form>
  );
}

/**
 * The dialog.
 * @param props - See `MacGuideEditDialogProps`.
 * @returns The dialog.
 */
export function MacGuideEditDialog(props: MacGuideEditDialogProps) {
  const { step, onClose } = props;
  return (
    <MacDialog open={step !== null} label={GUIDE_COPY.editTitle} onClose={onClose}>
      {step !== null && <Form key={step.n} {...props} step={step} />}
    </MacDialog>
  );
}
