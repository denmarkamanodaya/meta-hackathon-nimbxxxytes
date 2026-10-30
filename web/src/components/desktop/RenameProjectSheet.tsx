// "Rename…" in a project's options: the shared rename form with the project's name. The project
// may keep its own name in another case; other names follow the same rule.
import { SEGMENT_COPY } from '../../core/copy';
import { projectNameProblem } from '../../core/projects';
import { useProjectActions, useProjects } from '../../hooks/useProjects';
import type { Project } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

/** Props for `RenameProjectSheet`. */
export interface RenameProjectSheetProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

function Form({ project, onClose }: Omit<RenameProjectSheetProps, 'open'>) {
  const { state } = useProjects();
  const actions = useProjectActions();
  const projects = state.status === 'ready' ? state.data : [];
  return (
    <RenameForm
      heading={SEGMENT_COPY.rename}
      label="Name"
      initial={project.name}
      problemOf={(name) => projectNameProblem(name, projects, project.project_id)}
      isSaving={actions.isSaving}
      onSave={async (name) => (await actions.update(project.project_id, { name })) !== null}
      onClose={onClose}
    />
  );
}

/**
 * The sheet.
 * @param props - See `RenameProjectSheetProps`.
 * @returns The dialog.
 */
export function RenameProjectSheet({ open, project, onClose }: RenameProjectSheetProps) {
  return (
    <MacDialog open={open} label={SEGMENT_COPY.rename} onClose={onClose}>
      <Form project={project} onClose={onClose} />
    </MacDialog>
  );
}
