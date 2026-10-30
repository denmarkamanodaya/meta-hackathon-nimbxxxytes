// The New segment sheet (redesign v2, Projects board; projects are shown as segments): a name, one
// of six colours, and "Add the N selected items" when entries are selected. The name rule is
// checked as you type; Create opens the new segment.
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { SEGMENT_COPY } from '../../core/copy';
import { projectTargets } from '../../core/gallery-items';
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
  /** Gallery ids selected when it opened (clips and other kinds); the checkbox adds them. */
  itemIds: readonly string[];
  onClose: () => void;
}

function Form({ itemIds, onClose }: Omit<NewProjectSheetProps, 'open'>) {
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
    const { clipIds, items } = projectTargets(isAdding ? itemIds : []);
    const made = await actions.create({ name: name.trim(), color: chosen, ...(clipIds.length > 0 ? { clip_ids: clipIds } : {}) });
    if (made === null) return;
    // The other kinds go in once it exists; a failure there toasts and still opens the segment.
    if (items.length > 0) await actions.addItems(made.project_id, itemIds.filter((id) => !clipIds.includes(id)));
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
        {SEGMENT_COPY.newSegment}
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
      {itemIds.length > 0 && (
        <label className="new-project__check">
          <input
            type="checkbox"
            checked={isAdding}
            onChange={(event) => {
              setAdding(event.target.checked);
            }}
          />
          {addSelectedLine(itemIds.length)}
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
          {actions.isSaving ? 'Creating…' : SEGMENT_COPY.create}
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
export function NewProjectSheet({ open, itemIds, onClose }: NewProjectSheetProps) {
  return (
    <MacDialog open={open} label={SEGMENT_COPY.newSegment} onClose={onClose}>
      <Form itemIds={itemIds} onClose={onClose} />
    </MacDialog>
  );
}
