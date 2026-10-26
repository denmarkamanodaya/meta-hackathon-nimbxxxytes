// One version in the critique trail, in reading order: the agent's rationale, for v2+ what
// changed and why (each change linked to the critique note it answers), then the preview, the
// scores with their change since the previous version, and what the critique found (tap seeks).
import type { PlayerRef } from '@remotion/player';
import { useCallback, useRef } from 'react';
import type { ShortProps } from '@nimbytes/composition';
import { humanizeDetail, linkChanges, scoreDeltas, type LinkedChange } from '../core/agent-trail';
import { formatDuration } from '../core/format';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { Section } from '../design/Section';
import { Spinner } from '../design/Spinner';
import { useVideoSeek } from '../hooks/useVideoSeek';
import type { Aspect, Critique, RevisionAction, ShortVersion } from '../services/api/types';
import { ScoreBars } from './ScoreBars';
import { ShortPlayer } from './ShortPlayer';
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
  /** Player input (the version's props, or the edited draft's); null falls back to the MP4. */
  playerProps: ShortProps | null;
}

interface ChangesProps {
  changes: LinkedChange[];
  fromVersion: number;
  clips: Parameters<typeof humanizeDetail>[1];
  onShowNote: VersionPanelProps['onShowNote'];
}

function Changes({ changes, fromVersion, clips, onShowNote }: ChangesProps) {
  return (
    <Section title={`What changed from v${String(fromVersion)}`}>
      <ol className="version-panel__changes">
        {changes.map(({ change, note, noteVersion }, index) => (
          <li key={`${change.action}-${String(index)}`} className="version-panel__change">
            <div className="version-panel__what">
              <Chip tone="accent">{ACTION_LABEL[change.action]}</Chip>
              <span className="version-panel__detail">{humanizeDetail(change.detail, clips)}</span>
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
  );
}

function Findings({ critique, onSeek }: { critique: Critique; onSeek: (seconds: number) => void }) {
  if (critique.notes.length === 0) {
    return (
      <Section title="What the critique found">
        <p className="version-panel__clean">
          <Icon name="check" />
          {critique.verdict === 'accept'
            ? 'No issues left — the editor accepted this cut.'
            : 'No timestamped notes for this version.'}
        </p>
      </Section>
    );
  }
  return (
    <Section title="What the critique found" count={critique.notes.length}>
      <ol className="version-panel__notes">
        {critique.notes.map((note, index) => (
          <li key={`${String(note.at)}-${String(index)}`}>
            <button
              type="button"
              className="version-panel__note"
              onClick={() => {
                onSeek(note.at);
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
  );
}

/**
 * The reasoning for one version.
 * @param props - See `VersionPanelProps`.
 * @returns The panel.
 */
export function VersionPanel(props: VersionPanelProps) {
  const { version, versions, aspect, startSeconds, onShowNote, playerProps } = props;
  const { ref, seek: seekVideo, onTimeUpdate, onLoadedMetadata } = useVideoSeek(startSeconds);
  const playerRef = useRef<PlayerRef>(null);
  const fps = playerProps?.fps ?? 30;
  const seek = useCallback(
    (seconds: number) => {
      const player = playerRef.current;
      if (player === null) {
        seekVideo(seconds);
        return;
      }
      player.seekTo(Math.round(seconds * fps));
      player.play();
    },
    [seekVideo, fps],
  );
  const changes = linkChanges(version, versions);
  const fromVersion = version.timeline.revision?.from_version ?? null;
  const revised = versions.find((candidate) => candidate.n === fromVersion);
  const previous = versions.find((candidate) => candidate.n === version.n - 1);
  const ratio = aspect === '4:5' ? 'version-panel__preview--4-5' : 'version-panel__preview--1-1';

  return (
    <div className="version-panel">
      <blockquote className="version-panel__rationale">
        <Icon name="sparkle" />
        <p>{version.timeline.rationale}</p>
      </blockquote>
      {changes.length > 0 && fromVersion !== null && (
        <Changes
          changes={changes}
          fromVersion={fromVersion}
          clips={[version.timeline.clips, revised?.timeline.clips ?? []]}
          onShowNote={onShowNote}
        />
      )}
      <div className={`version-panel__preview ${ratio}`}>
        {playerProps !== null ? (
          <ShortPlayer
            props={playerProps}
            playerRef={playerRef}
            initialFrame={startSeconds === null ? 0 : Math.round(startSeconds * fps)}
          />
        ) : version.preview_url === null ? (
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
          <ScoreBars
            critique={version.critique}
            deltas={scoreDeltas(version.critique, previous?.critique ?? null)}
            previousN={previous?.n ?? null}
          />
          <Findings critique={version.critique} onSeek={seek} />
        </>
      )}
    </div>
  );
}
