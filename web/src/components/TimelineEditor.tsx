// The editable timeline of one version: cards with reorder (drag or ↑/↓), drop (swipe or
// Remove) and trim, the running length, and Save as a new version.
import { useMemo } from 'react';
import { diffClips, timelineLength, type ClipChange } from '../core/timeline-edit';
import { Button } from '../design/Button';
import { shiftFor, useDragReorder } from '../hooks/useGestures';
import type { TimelineDraft } from '../hooks/useTimelineDraft';
import type { ShortSegment, TimelineClip } from '../services/api/types';
import { TimelineCard } from './TimelineCard';
import './TimelineEditor.css';

/** Props for `TimelineEditor`. */
export interface TimelineEditorProps {
  draft: TimelineDraft;
  segments: readonly ShortSegment[];
  /** Previous version's clips, to badge what changed; null for v1. */
  previous: readonly TimelineClip[] | null;
  targetSeconds: number;
  onSaved: (versionN: number) => void;
}

/**
 * Timeline cards plus the save bar.
 * @param props - See `TimelineEditorProps`.
 * @returns The editor.
 */
export function TimelineEditor({ draft, segments, previous, targetSeconds, onSaved }: TimelineEditorProps) {
  const { clips } = draft;
  const { drag, handle } = useDragReorder(draft.move);
  const changes = useMemo(() => {
    const byId = new Map<string, ClipChange>();
    if (previous !== null) for (const d of diffClips(previous, clips)) byId.set(d.segment_id, d.change);
    return byId;
  }, [previous, clips]);
  const length = timelineLength(clips);

  return (
    <div className="timeline-editor">
      <p className="timeline-editor__length">
        {`${length.toFixed(1)} s of ${String(targetSeconds)} s · ${String(clips.length)} shots`}
        <span className="timeline-editor__hint">Drag ⋮⋮ to reorder · swipe left to remove</span>
      </p>
      <ol className="timeline-editor__list">
        {clips.map((clip, index) => (
          <TimelineCard
            key={clip.segment_id}
            clip={clip}
            segment={segments.find((s) => s.segment_id === clip.segment_id)}
            index={index}
            count={clips.length}
            change={changes.get(clip.segment_id) ?? null}
            offsetY={drag === null ? 0 : index === drag.from ? drag.offset : shiftFor(index, drag.from, drag.to, drag.height)}
            isDragging={drag?.from === index}
            dragHandle={handle(index)}
            onMove={draft.move}
            onDrop={draft.drop}
            onTrim={draft.trim}
          />
        ))}
      </ol>
      {draft.isDirty && (
        <div className="timeline-editor__save">
          <Button variant="secondary" onClick={draft.reset}>
            Undo edits
          </Button>
          <Button
            disabled={draft.saveState.status === 'saving' || clips.length === 0}
            onClick={() => {
              void draft.save().then((saved) => {
                if (saved !== null) onSaved(saved);
              });
            }}
          >
            {draft.saveState.status === 'saving' ? 'Saving…' : 'Save as new version'}
          </Button>
        </div>
      )}
    </div>
  );
}
