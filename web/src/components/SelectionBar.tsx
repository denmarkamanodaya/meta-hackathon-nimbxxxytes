// Dark floating bar above the tab bar while moments are picked: the count and "Make a short".
import { Icon } from '../design/Icon';
import './SelectionBar.css';

/** Props for `SelectionBar`. */
export interface SelectionBarProps {
  count: number;
  onMakeShort: () => void;
}

/**
 * The bar.
 * @param props - See `SelectionBarProps`.
 * @returns The bar.
 */
export function SelectionBar({ count, onMakeShort }: SelectionBarProps) {
  return (
    <div className="selection-bar" role="region" aria-label="Picked moments">
      <span className="selection-bar__count" role="status">{`${String(count)} ${count === 1 ? 'moment' : 'moments'} picked`}</span>
      <button type="button" className="selection-bar__go" onClick={onMakeShort}>
        Make a short
        <Icon name="arrow" size="sm" />
      </button>
    </div>
  );
}
