// "Rename…" in a project's options: the New project sheet's frame with the name field only. The
// project may keep its own name in another case; other names follow the same rule.
import { useId, useState } from 'react';
import { projectNameProblem } from '../../core/projects';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import type { Project } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './NewProjectSheet.css';

/** Props for `RenameProjectSheet`. */
export interface RenameProjectSheetProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

function Form({ project, onClose }: Omit<RenameProjectSheetProps, 'open'>) {
  const titleId = useId();
  const { state } = useProjects();
  const actions = useProjectActions();
  const projects = state.status === 'ready' ? state.data : [];
  const [name, setName] = useState(project.name);
  const problem = projectNameProblem(name, projects, project.project_id);
  const isSame = name.trim() === project.name;
  return (
    <form
      className="new-project"
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        if (problem !== null || isSame) return;
        void actions.update(project.project_id, { name: name.trim() }).then((saved) => {
          if (saved !== null) onClose();
        });
      }}
    >
      <h2 id={titleId} className="new-project__title">
        Rename project
      </h2>
      <label className="new-project__field">
        Name
        <input
          className="new-project__input"
          type="text"
          value={name}
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
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="mac-button new-project__create" disabled={problem !== null || isSame || actions.isSaving}>
          {actions.isSaving ? 'Saving…' : 'Rename'}
        </button>
      </div>
    </form>
  );
}

/**
 * The sheet.
 * @param props - See `RenameProjectSheetProps`.
 * @returns The dialog.
 */
export function RenameProjectSheet({ open, project, onClose }: RenameProjectSheetProps) {
  return (
    <MacDialog open={open} label="Rename project" onClose={onClose}>
      <Form project={project} onClose={onClose} />
    </MacDialog>
  );
}
