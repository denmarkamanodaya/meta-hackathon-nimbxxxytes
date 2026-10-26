// One version in the critique trail: the agent's rationale, the preview, five scores, the
// timestamped critique notes (tap seeks the preview), and for v2+ each change as
// "what changed → why", linked to the note it answers.
import { linkChanges } from '../core/agent-trail';
import { formatDuration } from '../core/format';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { Section } from '../design/Section';
import { Spinner } from '../design/Spinner';
import { useVideoSeek } from '../hooks/useVideoSeek';
import type { Aspect, RevisionAction, ShortVersion } from '../services/api/types';
import { ScoreBars } from './ScoreBars';
import './VersionPanel.css';

const ACTION_LABEL: Record<RevisionAction, string> = {
  add: 'Added',
  remove: 'Removed',
  swap: 'Swapped',
  trim: 'Trimmed',
  reorder: 'Reordered',
  retime_captions: 'Retimed captions',
};

/** Props for `VersionPanel`. */
export interface VersionPanelProps {
  version: ShortVersion;
  versions: readonly ShortVersion[];
  aspect: Aspect;
  /** Seconds to open the preview at (a note tapped on another version), or null. */
  startSeconds: number | null;
  /** Shows a note of another version: select it and seek its preview there. */
  onShowNote: (versionN: number, seconds: number) => void;
}

/**
 * The reasoning for one version.
 * @param props - See `VersionPanelProps`.
 * @returns The panel.
 */
export function VersionPanel({ version, versions, aspect, startSeconds, onShowNote }: VersionPanelProps) {
  const { ref, seek, onTimeUpdate, onLoadedMetadata } = useVideoSeek(startSeconds);
  const changes = linkChanges(version, versions);
  const ratio = aspect === '4:5' ? 'version-panel__preview--4-5' : 'version-panel__preview--1-1';

  return (
    <div className="version-panel">
      <blockquote className="version-panel__rationale">
        <Icon name="sparkle" />
        <p>{version.timeline.rationale}</p>
      </blockquote>
      <div className={`version-panel__preview ${ratio}`}>
        {version.preview_url === null ? (
          <div className="version-panel__pending" role="status">
            <Spinner />
            {`Rendering v${String(version.n)} preview…`}
          </div>
        ) : (
          <video
            ref={ref}
            className="version-panel__video"
            src={version.preview_url}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onLoadedMetadata={onLoadedMetadata}
          />
        )}
      </div>
      {version.critique === null ? (
        <p className="version-panel__muted">
          <Spinner /> Watching the preview…
        </p>
      ) : (
        <>
          <ScoreBars critique={version.critique} />
          <Section title="What the critique found" count={version.critique.notes.length}>
            <ol className="version-panel__notes">
              {version.critique.notes.map((note, index) => (
                <li key={`${String(note.at)}-${String(index)}`}>
                  <button
                    type="button"
                    className="version-panel__note"
                    onClick={() => {
                      seek(note.at);
                    }}
                  >
                    <span className="version-panel__at">{formatDuration(note.at)}</span>
                    <span>
                      <span className="version-panel__issue">{note.issue}</span>
                      <span className="version-panel__fix">{note.fix}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
      {changes.length > 0 && (
        <Section title={`What changed from v${String(version.timeline.revision?.from_version ?? 1)}`}>
          <ol className="version-panel__changes">
            {changes.map(({ change, note, noteVersion }, index) => (
              <li key={`${change.action}-${String(index)}`} className="version-panel__change">
                <div className="version-panel__what">
                  <Chip tone="accent">{ACTION_LABEL[change.action]}</Chip>
                  <span className="version-panel__detail">{change.detail}</span>
                </div>
                <p className="version-panel__why">
                  <span aria-hidden="true">→ </span>
                  {change.why}
                </p>
                {note !== null && (
                  <button
                    type="button"
                    className="version-panel__answers"
                    onClick={() => {
                      onShowNote(noteVersion, note.at);
                    }}
                  >
                    {`Answers v${String(noteVersion)} at ${formatDuration(note.at)}: “${note.issue}”`}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}
