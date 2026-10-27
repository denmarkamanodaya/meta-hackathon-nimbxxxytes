// Toggle primitive: the compact Mac switch of redesign v2 (32 x 18 track, 14 px knob, accent when
// on), a button with role="switch". The visible words sit beside it; `label` names it for
// assistive tech.
import './Toggle.css';

/** Props for `Toggle`. */
export interface ToggleProps {
  checked: boolean;
  /** Called with the new state when the user flips it. */
  onChange: (next: boolean) => void;
  /** Accessible name. */
  label: string;
  disabled?: boolean;
}

/**
 * The switch.
 * @param props - See `ToggleProps`.
 * @returns The button.
 */
export function Toggle({ checked, onChange, label, disabled = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? 'toggle toggle--on' : 'toggle'}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="toggle__knob" aria-hidden="true" />
    </button>
  );
}
