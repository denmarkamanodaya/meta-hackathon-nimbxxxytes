// The New project sheet (redesign v2, Projects board): a name, one of six colours, and "Add the N
// selected clips" when clips are selected. The name rule is checked as you type; Create opens the
// new project.
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { addSelectedLine, nextProjectColor, PROJECT_COLOR_LABEL, projectNameProblem } from '../../core/projects';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import { PROJECT_COLORS, type ProjectColor } from '../../services/api/types';
import { projectColorClass } from './ProjectSwatch';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './NewProjectSheet.css';

/** Props for `NewProjectSheet`. */
export interface NewProjectSheetProps {
  open: boolean;
  /** Clips selected when it opened; the checkbox adds them. */
  clipIds: readonly string[];
  onClose: () => void;
}

function Form({ clipIds, onClose }: Omit<NewProjectSheetProps, 'open'>) {
  const titleId = useId();
  const { state } = useProjects();
  const actions = useProjectActions();
  const navigate = useNavigate();
  const projects = state.status === 'ready' ? state.data : [];
  const [name, setName] = useState('');
  const [color, setColor] = useState<ProjectColor | null>(null);
  const [isAdding, setAdding] = useState(true);
  const problem = name === '' ? null : projectNameProblem(name, projects, null);
  const chosen = color ?? nextProjectColor(projects);

  const create = async () => {
    if (projectNameProblem(name, projects, null) !== null) return;
    const made = await actions.create({
      name: name.trim(),
      color: chosen,
      ...(isAdding && clipIds.length > 0 ? { clip_ids: [...clipIds] } : {}),
    });
    if (made === null) return;
    onClose();
    void navigate(`/projects/${encodeURIComponent(made.project_id)}`);
  };

  return (
    <form
      className="new-project"
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <h2 id={titleId} className="new-project__title">
        New project
      </h2>
      <label className="new-project__field">
        Name
        <input
          className="new-project__input"
          type="text"
          value={name}
          maxLength={120}
          autoFocus
          aria-invalid={problem !== null}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        {problem !== null && (
          <span className="new-project__problem" role="alert">
            {problem}
          </span>
        )}
      </label>
      <fieldset className="new-project__colours">
        <legend className="new-project__legend">Colour</legend>
        <div className="new-project__swatches">
          {PROJECT_COLORS.map((option) => (
            <button
              key={option}
              type="button"
              aria-label={PROJECT_COLOR_LABEL[option]}
              aria-pressed={option === chosen}
              className={`new-project__swatch ${projectColorClass(option)}${option === chosen ? ' new-project__swatch--on' : ''}`}
              onClick={() => {
                setColor(option);
              }}
            />
          ))}
        </div>
      </fieldset>
      {clipIds.length > 0 && (
        <label className="new-project__check">
          <input
            type="checkbox"
            checked={isAdding}
            onChange={(event) => {
              setAdding(event.target.checked);
            }}
          />
          {addSelectedLine(clipIds.length)}
        </label>
      )}
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="mac-button new-project__create"
          disabled={name.trim() === '' || problem !== null || actions.isSaving}
        >
          {actions.isSaving ? 'Creating…' : 'Create project'}
        </button>
      </div>
    </form>
  );
}

/**
 * The sheet: a centred modal dialog (Esc or a click outside closes it).
 * @param props - See `NewProjectSheetProps`.
 * @returns The dialog.
 */
export function NewProjectSheet({ open, clipIds, onClose }: NewProjectSheetProps) {
  return (
    <MacDialog open={open} label="New project" onClose={onClose}>
      <Form clipIds={clipIds} onClose={onClose} />
    </MacDialog>
  );
}
