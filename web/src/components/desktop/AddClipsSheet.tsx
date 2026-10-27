// "Add clips" on a project page: the Gallery's clips that are not in the project yet, ticked one
// by one, then "Add N clips".
import { useState } from 'react';
import { clipCount, recordedDay } from '../../core/gallery';
import { useClips } from '../../hooks/useClips';
import { useProjectActions } from '../../hooks/useProjects';
import type { Project } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './NewProjectSheet.css';
import './AddClipsSheet.css';

/** Props for `AddClipsSheet`. */
export interface AddClipsSheetProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

function Picker({ project, onClose }: Omit<AddClipsSheetProps, 'open'>) {
  const { state } = useClips();
  const { addClips, isSaving } = useProjectActions();
  const [picked, setPicked] = useState<string[]>([]);
  const outside = state.status === 'ready' ? state.data.filter((clip) => clip.status !== 'duplicate' && !clip.project_ids.includes(project.project_id)) : [];
  return (
    <form
      className="new-project"
      onSubmit={(event) => {
        event.preventDefault();
        void addClips(project.project_id, picked).then((isDone) => {
          if (isDone) onClose();
        });
      }}
    >
      <h2 className="new-project__title">{`Add clips to ${project.name}`}</h2>
      {state.status === 'loading' && <p className="add-clips__empty">Loading your clips…</p>}
      {state.status === 'ready' && outside.length === 0 && <p className="add-clips__empty">Every clip is already in this project.</p>}
      <ul className="add-clips__list">
        {outside.map((clip) => (
          <li key={clip.clip_id}>
            <label className="add-clips__row">
              <input
                type="checkbox"
                checked={picked.includes(clip.clip_id)}
                onChange={(event) => {
                  setPicked(event.target.checked ? [...picked, clip.clip_id] : picked.filter((id) => id !== clip.clip_id));
                }}
              />
              <span className="add-clips__thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" />}</span>
              <span className="add-clips__name">{clip.title}</span>
              <span className="add-clips__date">{recordedDay(clip.recorded_at)}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="new-project__actions">
        <button type="button" className="mac-button mac-button--quiet" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="mac-button new-project__create" disabled={picked.length === 0 || isSaving}>
          {picked.length === 0 ? 'Add clips' : `Add ${clipCount(picked.length)}`}
        </button>
      </div>
    </form>
  );
}

/**
 * The sheet: a centred modal dialog (Esc or a click outside closes it).
 * @param props - See `AddClipsSheetProps`.
 * @returns The dialog.
 */
export function AddClipsSheet({ open, project, onClose }: AddClipsSheetProps) {
  return (
    <MacDialog open={open} label="Add clips" onClose={onClose}>
      <Picker project={project} onClose={onClose} />
    </MacDialog>
  );
}
