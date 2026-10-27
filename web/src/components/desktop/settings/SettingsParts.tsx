// The parts every Settings section is built from (redesign v2, V6): the section heading with its
// lead line, a row (title, muted hint, control on the right) and a small segmented pick group
// whose chosen option is accent text with no fill.
import type { ReactNode } from 'react';

/**
 * A section's heading and optional lead line.
 * @param props - The title and lead.
 * @returns The heading.
 */
export function SettingsHeading({ title, lead }: { title: string; lead?: string }) {
  return (
    <>
      <h2 className={lead === undefined ? 'mac-set__title' : 'mac-set__title mac-set__title--lead'}>{title}</h2>
      {lead !== undefined && <p className="mac-set__lead">{lead}</p>}
    </>
  );
}

/** Props for `SettingRow`. */
export interface SettingRowProps {
  title: string;
  hint?: string;
  /** The control or value on the right. */
  children?: ReactNode;
}

/**
 * One row: title and hint on the left, the control on the right, a divider under it.
 * @param props - See `SettingRowProps`.
 * @returns The row.
 */
export function SettingRow({ title, hint, children }: SettingRowProps) {
  return (
    <div className="mac-set__row">
      <div className="mac-set__row-text">
        <div className="mac-set__row-title">{title}</div>
        {hint !== undefined && <div className="mac-set__hint">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

/** Props for `PickGroup`. */
export interface PickGroupProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  /** The chosen option; null for none. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A row of joined buttons; the chosen one is accent text.
 * @param props - See `PickGroupProps`.
 * @returns The group.
 */
export function PickGroup<T extends string>({ label, options, value, onChange, disabled = false }: PickGroupProps<T>) {
  return (
    <span className="mac-set__pick" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="mac-set__pick-option"
          aria-pressed={option.value === value}
          disabled={disabled}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}
