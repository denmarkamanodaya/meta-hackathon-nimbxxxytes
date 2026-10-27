// What the editor saw and what it changed (Mist): the critique notes of the watched draft with
// mono times in the problem colour, then the shown draft's changes, numbered by the note each
// one answers. All agent text goes through the humanizer (no ids, no field names).
import { linkChanges } from '../core/agent-trail';
import { formatDuration } from '../core/format';
import { humanizeDetail, humanizeNote, type ShotNames } from '../core/humanize';
import type { RevisionAction, ShortVersion } from '../services/api/types';
import './DraftStory.css';

const ACTION_LABEL: Record<RevisionAction, string> = {
  add: 'Added',
  remove: 'Removed',
  swap: 'Swapped',
  trim: 'Trimmed',
  reorder: 'Reordered',
  retime_captions: 'Retimed captions:',
};

/** Props for `EditorWatched`. */
export interface EditorWatchedProps {
  watched: ShortVersion;
  names: ShotNames;
}

/**
 * "The editor watched draft N" and its notes.
 * @param props - See `EditorWatchedProps`.
 * @returns The card, or null when the critique is missing.
 */
export function EditorWatched({ watched, names }: EditorWatchedProps) {
  const critique = watched.critique;
  if (critique === null) return null;
  return (
    <section className="draft-story draft-story--watched" aria-label="What the editor saw">
      <h2 className="draft-story__title">{`The editor watched draft ${String(watched.n)}`}</h2>
      {critique.notes.length === 0 ? (
        <p className="draft-story__clean">No issues left — the editor accepted this cut.</p>
      ) : (
        <ol className="draft-story__list">
          {critique.notes.map((note, index) => (
            <li key={`${String(note.at)}-${String(index)}`} className="draft-story__note">
              <span className="draft-story__at">{formatDuration(note.at)}</span>
              <span>{humanizeNote(note.issue, names)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Props for `DraftChanges`. */
export interface DraftChangesProps {
  shown: ShortVersion;
  versions: readonly ShortVersion[];
  names: ShotNames;
}

/**
 * "So draft N changed": one line per change, numbered by the note it answers.
 * @param props - See `DraftChangesProps`.
 * @returns The card, or null for a first draft.
 */
export function DraftChanges({ shown, versions, names }: DraftChangesProps) {
  const changes = linkChanges(shown, versions);
  if (changes.length === 0) return null;
  return (
    <section className="draft-story draft-story--changed" aria-label="What changed">
      <h2 className="draft-story__title draft-story__title--accent">{`So draft ${String(shown.n)} changed`}</h2>
      <ol className="draft-story__list">
        {changes.map(({ change }, index) => (
          <li key={`${change.action}-${String(index)}`} className="draft-story__note">
            <span className="draft-story__number">{(change.note_index ?? index) + 1}</span>
            <span>{`${ACTION_LABEL[change.action]} ${humanizeDetail(change.detail, names)}`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
