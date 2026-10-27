// Dark floating bar above the tab bar while Search is in select mode: what is picked ("2 moments ·
// 0:15"), what the editor will do with it, and "Make a short" (off until a moment is picked).
import './SelectionBar.css';

/** Props for `SelectionBar`. */
export interface SelectionBarProps {
  /** "2 moments · 0:15". */
  summary: string;
  canMakeShort: boolean;
  onMakeShort: () => void;
}

/**
 * The bar.
 * @param props - See `SelectionBarProps`.
 * @returns The bar.
 */
export function SelectionBar({ summary, canMakeShort, onMakeShort }: SelectionBarProps) {
  return (
    <div className="selection-bar" role="region" aria-label="Picked moments">
      <span className="selection-bar__text">
        <span className="selection-bar__count" role="status">
          {summary}
        </span>
        <span className="selection-bar__hint">The editor plans, cuts and checks its own draft</span>
      </span>
      <button type="button" className="selection-bar__go" disabled={!canMakeShort} onClick={onMakeShort}>
        Make a short
      </button>
    </div>
  );
}
