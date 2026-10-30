// The bar Select mode shows over the Gallery (Mac) and the Library (phone): "3 clips selected",
// "Make a short" (off until a selected clip has moments) and "Cancel", which leaves the mode. The
// Mac Gallery adds "Add to segment", which opens the segment menu (pick one or make a new one).
// It wears the Search selection bar's look. In the Gallery's mixed view it also offers "Delete" and
// Add to segment for every kind ("2 selected" when photos, recordings or documents are in).
import type { MouseEvent } from 'react';
import { SEGMENT_COPY } from '../core/copy';
import { clipsSelectedLine } from '../core/selection';
import { Icon } from '../design/Icon';
import './SelectionBar.css';
import './ClipSelectBar.css';

/** Props for `ClipSelectBar`. */
export interface ClipSelectBarProps {
  /** Clips selected. */
  count: number;
  /** A selected clip is ready and has moments. */
  canMakeShort: boolean;
  onMakeShort: () => void;
  /** Opens the Add to segment menu under the button; left out, the bar has no such button. */
  onAddToProject?: (event: MouseEvent<HTMLButtonElement>) => void;
  onCancel: () => void;
  /** The count line in place of "3 clips selected" (the mixed view says "3 selected"). */
  line?: string;
  /** Deletes what is ticked; left out, the bar has no Delete. */
  onDelete?: () => void;
  /** `fixed` floats above the phone's tab bar; `column` sits at the foot of the Mac Gallery. */
  place: 'fixed' | 'column';
}

/**
 * The bar.
 * @param props - See `ClipSelectBarProps`.
 * @returns The bar.
 */
export function ClipSelectBar({ count, canMakeShort, onMakeShort, onAddToProject, onCancel, line, onDelete, place }: ClipSelectBarProps) {
  return (
    <div className={`selection-bar clip-select-bar clip-select-bar--${place}`} role="region" aria-label="Selected clips">
      <span className="selection-bar__count" role="status">
        {line ?? clipsSelectedLine(count)}
      </span>
      <span className="clip-select-bar__actions">
        {onAddToProject !== undefined && (
          <button type="button" className="clip-select-bar__add" aria-haspopup="menu" disabled={count === 0} onClick={onAddToProject}>
            {SEGMENT_COPY.addTo}
            <Icon name="chevron-down" size="xs" />
          </button>
        )}
        <button type="button" className="selection-bar__go" disabled={!canMakeShort} onClick={onMakeShort}>
          Make a short
        </button>
        {onDelete !== undefined && (
          <button type="button" className="clip-select-bar__add clip-select-bar__delete" disabled={count === 0} onClick={onDelete}>
            Delete
          </button>
        )}
        <button type="button" className="clip-select-bar__cancel" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
