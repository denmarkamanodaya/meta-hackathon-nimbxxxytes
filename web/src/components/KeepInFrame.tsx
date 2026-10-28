// Keep subject in frame (board V19), the parts both Short pages place: the Centre crop / Follows
// subject preview switch, "What each shot follows" (each shot's subject chip, editable, and how
// well it was followed), and the Keep subject in frame switch with its status and cost lines.
import { useEffect, useRef, useState } from 'react';
import { REFRAME_COPY } from '../core/copy';
import type { NleShot } from '../core/nle-shots';
import { reframeSummary, shotRow, shotStatus } from '../core/reframe';
import { Icon } from '../design/Icon';
import { Toggle } from '../design/Toggle';
import type { KeepInFrame } from '../hooks/useKeepInFrame';
import { useShotSubject } from '../hooks/useShotSubject';
import type { Timeline } from '../services/api/types';
import './KeepInFrame.css';

/**
 * "Centre crop | Follows subject" over the preview, and what the chosen one does.
 * @param props - The handle.
 * @returns The switch and its note.
 */
export function ReframePreviewSwitch({ keep }: { keep: KeepInFrame }) {
  const options = [
    { follow: false, label: REFRAME_COPY.centreCrop },
    { follow: true, label: REFRAME_COPY.followsSubject },
  ];
  return (
    <div className="keep-frame__preview">
      <div className="keep-frame__seg" role="radiogroup" aria-label={REFRAME_COPY.preview}>
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={keep.isFollow === option.follow}
            className={keep.isFollow === option.follow ? 'keep-frame__seg-option keep-frame__seg-option--on' : 'keep-frame__seg-option'}
            onClick={() => {
              keep.setFollow(option.follow);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The note under the preview.
 * @param props - The handle.
 * @returns The note.
 */
export function ReframePreviewNote({ keep }: { keep: KeepInFrame }) {
  return <span className="keep-frame__muted">{keep.isFollow ? REFRAME_COPY.followNote : REFRAME_COPY.centreNote}</span>;
}

interface SubjectChipProps {
  subject: string | null;
  isSaving: boolean;
  onSave: (subject: string) => Promise<boolean>;
}

/** The subject chip; a click turns it into a field (Enter saves, Esc or blur without a change cancels). */
function SubjectChip({ subject, isSaving, onSave }: SubjectChipProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const isEditing = draft !== null;
  // The field opens on a click of the chip, so focus goes to it.
  useEffect(() => {
    if (isEditing) fieldRef.current?.focus();
  }, [isEditing]);
  if (draft !== null) {
    const commit = () => {
      void onSave(draft).then((isSaved) => {
        if (isSaved || draft.trim() === (subject ?? '')) setDraft(null);
      });
    };
    return (
      <input
        className="keep-frame__chip-field"
        aria-label={REFRAME_COPY.subjectField}
        value={draft}
        disabled={isSaving}
        ref={fieldRef}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(null);
        }}
        onBlur={() => {
          if (draft.trim() === '' || draft.trim() === (subject ?? '')) setDraft(null);
          else commit();
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="keep-frame__chip"
      onClick={() => {
        setDraft(subject ?? '');
      }}
    >
      <Icon name="target" size="xs" />
      {subject ?? REFRAME_COPY.subjectField}
    </button>
  );
}

/** Props for `ShotSubjects`. */
export interface ShotSubjectsProps {
  shortId: string;
  timeline: Timeline;
  /** The shots as the page lists them (start, thumbnail, name), in timeline order. */
  rows: readonly NleShot[];
  keep: KeepInFrame;
  /** A subject was saved as draft `n`. */
  onSaved: (n: number) => void;
}

/**
 * "What each shot follows".
 * @param props - See `ShotSubjectsProps`.
 * @returns The section.
 */
export function ShotSubjects({ shortId, timeline, rows, keep, onSaved }: ShotSubjectsProps) {
  const subjects = useShotSubject(shortId, timeline);
  const status = keep.reframe?.status ?? 'idle';
  return (
    <section className="keep-frame__shots" aria-label={REFRAME_COPY.shotsTitle}>
      <div className="keep-frame__shots-head">
        <h2 className="keep-frame__title">{REFRAME_COPY.shotsTitle}</h2>
        <span className="keep-frame__muted-sm">{REFRAME_COPY.shotsHint}</span>
      </div>
      {timeline.clips.map((clip, index) => {
        const row = rows[index];
        const line = shotStatus(clip, status, shotRow(keep.reframe, clip));
        return (
          <div key={row?.key ?? `${String(index)}:${clip.segment_id}`} className="keep-frame__shot">
            <span className="keep-frame__at">{row?.at ?? ''}</span>
            <span className="keep-frame__thumb">{row?.thumbUrl != null && <img src={row.thumbUrl} alt="" loading="lazy" />}</span>
            <span className="keep-frame__shot-text">
              <span className="keep-frame__shot-name">{row?.name ?? clip.segment_id}</span>
              <span className={line.isLost ? 'keep-frame__status keep-frame__status--lost' : 'keep-frame__status'}>{line.text}</span>
            </span>
            <SubjectChip
              subject={clip.subject}
              isSaving={subjects.savingIndex === index}
              onSave={async (text) => {
                const n = await subjects.save(index, text);
                if (n !== null) onSaved(n);
                return n !== null;
              }}
            />
          </div>
        );
      })}
    </section>
  );
}

/**
 * "Keep subject in frame", its switch, the status line and the cost line.
 * @param props - The handle and the shown shots.
 * @returns The block.
 */
export function KeepSubjectSwitch({ keep, timeline }: { keep: KeepInFrame; timeline: Timeline }) {
  const isOn = keep.finish?.keep_subject ?? false;
  return (
    <div className="keep-frame__finish">
      <div className="keep-frame__switch">
        <span className="keep-frame__switch-text">
          <span className="keep-frame__switch-title">{REFRAME_COPY.keepSubject}</span>
          <span className="keep-frame__muted">{REFRAME_COPY.keepSubjectHint}</span>
        </span>
        <Toggle
          checked={isOn}
          disabled={keep.finish === null || keep.isSaving}
          label={REFRAME_COPY.keepSubject}
          onChange={keep.setKeepSubject}
        />
      </div>
      <div className="keep-frame__lines">
        <span className="keep-frame__summary" role="status">
          {reframeSummary(isOn, keep.reframe, timeline.clips)}
        </span>
        <span className="keep-frame__muted-sm">{REFRAME_COPY.cost}</span>
      </div>
    </div>
  );
}

/**
 * "Blur hidden faces" under the switch on the Mac (board V19's Finish column).
 * @param props - The handle.
 * @returns The row.
 */
export function BlurFacesSwitch({ keep }: { keep: KeepInFrame }) {
  return (
    <div className="keep-frame__switch keep-frame__switch--rule">
      <span className="keep-frame__switch-text">
        <span className="keep-frame__switch-title">{REFRAME_COPY.blurFaces}</span>
        <span className="keep-frame__muted">{REFRAME_COPY.blurFacesHint}</span>
      </span>
      <Toggle
        checked={keep.finish?.blur_bystanders ?? true}
        disabled={keep.finish === null || keep.isSaving}
        label={REFRAME_COPY.blurFaces}
        onChange={keep.setBlurFaces}
      />
    </div>
  );
}
