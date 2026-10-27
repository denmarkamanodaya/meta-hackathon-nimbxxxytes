// SegmentedControl primitive: a small radio group drawn as joined buttons.
import { useId } from 'react';
import './SegmentedControl.css';

/** One option. */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** A count drawn muted after the label (the Mac right column's tabs). */
  count?: number;
}

/** Props for `SegmentedControl`. */
export interface SegmentedControlProps<T extends string> {
  /** Accessible group name. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Native radio inputs (arrow keys work) styled as a segmented control.
 * @param props - See `SegmentedControlProps`.
 * @returns The fieldset.
 */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className="visually-hidden">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={`segmented__option${option.value === value ? ' segmented__option--on' : ''}`}
        >
          <input
            className="visually-hidden"
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
