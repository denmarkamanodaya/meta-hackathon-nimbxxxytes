// Bar above the tab bar in select mode: how many moments are picked, cancel, and hand-off.
import { Button } from '../design/Button';
import './SelectionBar.css';

/** Props for `SelectionBar`. */
export interface SelectionBarProps {
  count: number;
  onCancel: () => void;
  onMakeShort: () => void;
}

/**
 * Fixed action bar; "Make a short" is disabled until something is picked.
 * @param props - See `SelectionBarProps`.
 * @returns The bar.
 */
export function SelectionBar({ count, onCancel, onMakeShort }: SelectionBarProps) {
  return (
    <div className="selection-bar" role="region" aria-label="Selected moments">
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button disabled={count === 0} onClick={onMakeShort}>
        {`Make a short (${String(count)})`}
      </Button>
    </div>
  );
}
