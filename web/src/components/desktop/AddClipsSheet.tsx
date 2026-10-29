// Picking Gallery clips, ticked one by one: "Add clips" on a project page (the clips not in the
// project yet, then "Add N clips"), and the Ask box's "Add clips from Gallery…" (any clip, then
// "Add N clips" to the request).
import { useState } from 'react';
import { isUncounted } from '../../core/clip-view';
import { clipCount, recordedDay } from '../../core/gallery';
import { useClips } from '../../hooks/useClips';
import { useProjectActions } from '../../hooks/useProjects';
import type { ClipSummary, Project } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import './MacColumns.css';
import './NewProjectSheet.css';
import './AddClipsSheet.css';

/** Props for `ClipChecklist`. */
interface ChecklistProps {
  title: string;
  /** Said when the list is loaded and empty. */
  emptyLine: string;
  clips: readonly ClipSummary[];
  isLoading: boolean;
  picked: readonly string[];
  onPicked: (picked: string[]) => void;
  /** Most clips that can be ticked; null for no limit. */
  max: number | null;
  isSaving: boolean;
  onSubmit: () => void;
  onClose: () => void;
}

/** The sheet's form: the title, the ticked list, Cancel and "Add N clips". */
function ClipChecklist({ title, emptyLine, clips, isLoading, picked, onPicked, max, isSaving, onSubmit, onClose }: ChecklistProps) {
  const isFull = max !== null && picked.length >= max;
  return (
    <form
      className="new-project"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h2 className="new-project__title">{title}</h2>
      {isLoading && <p className="add-clips__empty">Loading your clips…</p>}
      {!isLoading && clips.length === 0 && <p className="add-clips__empty">{emptyLine}</p>}
      <ul className="add-clips__list">
        {clips.map((clip) => {
          const isPicked = picked.includes(clip.clip_id);
          return (
            <li key={clip.clip_id}>
              <label className="add-clips__row">
                <input
                  type="checkbox"
                  checked={isPicked}
                  disabled={!isPicked && isFull}
                  onChange={(event) => {
                    onPicked(event.target.checked ? [...picked, clip.clip_id] : picked.filter((id) => id !== clip.clip_id));
                  }}
                />
                <span className="add-clips__thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" />}</span>
                <span className="add-clips__name">{clip.title}</span>
                <span className="add-clips__date">{recordedDay(clip.recorded_at)}</span>
              </label>
            </li>
          );
        })}
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

/** Props for `AddClipsSheet`. */
export interface AddClipsSheetProps {
  open: boolean;
  project: Project;
  onClose: () => void;
}

function ProjectPicker({ project, onClose }: Omit<AddClipsSheetProps, 'open'>) {
  const { state } = useClips();
  const { addClips, isSaving } = useProjectActions();
  const [picked, setPicked] = useState<string[]>([]);
  const outside = state.status === 'ready' ? state.data.filter((clip) => !isUncounted(clip.status) && !clip.project_ids.includes(project.project_id)) : [];
  return (
    <ClipChecklist
      title={`Add clips to ${project.name}`}
      emptyLine="Every clip is already in this project."
      clips={outside}
      isLoading={state.status === 'loading'}
      picked={picked}
      onPicked={setPicked}
      max={null}
      isSaving={isSaving}
      onSubmit={() => {
        void addClips(project.project_id, picked).then((isDone) => {
          if (isDone) onClose();
        });
      }}
      onClose={onClose}
    />
  );
}

/**
 * The project sheet: a centred modal dialog (Esc or a click outside closes it).
 * @param props - See `AddClipsSheetProps`.
 * @returns The dialog.
 */
export function AddClipsSheet({ open, project, onClose }: AddClipsSheetProps) {
  return (
    <MacDialog open={open} label="Add clips" onClose={onClose}>
      <ProjectPicker project={project} onClose={onClose} />
    </MacDialog>
  );
}

/** Props for `PickClipsSheet`. */
export interface PickClipsSheetProps {
  open: boolean;
  /** Clips already added; they start ticked. */
  added: readonly string[];
  /** Most clips the request can carry. */
  max: number;
  /** Gets every ticked clip, in tick order. */
  onPick: (clips: ClipSummary[]) => void;
  onClose: () => void;
}

function RequestPicker({ added, max, onPick, onClose }: Omit<PickClipsSheetProps, 'open'>) {
  const { state } = useClips();
  const [picked, setPicked] = useState<string[]>([...added]);
  const clips = state.status === 'ready' ? state.data.filter((clip) => !isUncounted(clip.status)) : [];
  return (
    <ClipChecklist
      title="Add clips to your request"
      emptyLine="Your Gallery has no clips yet."
      clips={clips}
      isLoading={state.status === 'loading'}
      picked={picked}
      onPicked={setPicked}
      max={max}
      isSaving={false}
      onSubmit={() => {
        onPick(picked.flatMap((id) => clips.filter((clip) => clip.clip_id === id)));
      }}
      onClose={onClose}
    />
  );
}

/**
 * The Ask box's sheet: a centred modal dialog (Esc or a click outside closes it).
 * @param props - See `PickClipsSheetProps`.
 * @returns The dialog.
 */
export function PickClipsSheet({ open, added, max, onPick, onClose }: PickClipsSheetProps) {
  return (
    <MacDialog open={open} label="Add clips from Gallery" onClose={onClose}>
      <RequestPicker added={added} max={max} onPick={onPick} onClose={onClose} />
    </MacDialog>
  );
}
