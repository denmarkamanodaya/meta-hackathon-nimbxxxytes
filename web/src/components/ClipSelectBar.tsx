// The bar Select mode shows over the Gallery (Mac) and the Library (phone): "3 clips selected",
// "Make a short" (off until a selected clip has moments) and "Cancel", which leaves the mode.
// It wears the Search selection bar's look.
import { clipsSelectedLine } from '../core/selection';
import './SelectionBar.css';
import './ClipSelectBar.css';

/** Props for `ClipSelectBar`. */
export interface ClipSelectBarProps {
  /** Clips selected. */
  count: number;
  /** A selected clip is ready and has moments. */
  canMakeShort: boolean;
  onMakeShort: () => void;
  onCancel: () => void;
  /** `fixed` floats above the phone's tab bar; `column` sits at the foot of the Mac Gallery. */
  place: 'fixed' | 'column';
}

/**
 * The bar.
 * @param props - See `ClipSelectBarProps`.
 * @returns The bar.
 */
export function ClipSelectBar({ count, canMakeShort, onMakeShort, onCancel, place }: ClipSelectBarProps) {
  return (
    <div className={`selection-bar clip-select-bar clip-select-bar--${place}`} role="region" aria-label="Selected clips">
      <span className="selection-bar__count" role="status">
        {clipsSelectedLine(count)}
      </span>
      <span className="clip-select-bar__actions">
        <button type="button" className="selection-bar__go" disabled={!canMakeShort} onClick={onMakeShort}>
          Make a short
        </button>
        <button type="button" className="clip-select-bar__cancel" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </div>
  );
}
