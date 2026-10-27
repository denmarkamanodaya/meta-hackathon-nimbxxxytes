// SwitchRow primitive: a bordered row with a title, a muted line under it, and an on/off switch
// drawn from a native checkbox (role="switch").
import './SwitchRow.css';

/** Props for `SwitchRow`. */
export interface SwitchRowProps {
  /** Bold first line. */
  title: string;
  /** Muted line under the title. */
  description: string;
  /** A second muted line (a fact the user must not miss, such as what turning it off deletes). */
  note?: string;
  checked: boolean;
  disabled?: boolean;
  /** Called with the new state when the user flips the switch. */
  onChange: (checked: boolean) => void;
}

/**
 * The row; the whole row is the switch's label, so any tap on it flips the switch.
 * @param props - See `SwitchRowProps`.
 * @returns The label element.
 */
export function SwitchRow({ title, description, note, checked, disabled = false, onChange }: SwitchRowProps) {
  return (
    <label className="switch-row">
      <span className="switch-row__text">
        <span className="switch-row__title">{title}</span>
        <span className="switch-row__description">{description}</span>
        {note !== undefined && <span className="switch-row__description">{note}</span>}
      </span>
      <input
        className="switch-row__input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      />
    </label>
  );
}
