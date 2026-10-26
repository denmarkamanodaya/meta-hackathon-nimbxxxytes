// Text field with a label, used by the naming sheets.
import './NameField.css';

/** Props for `NameField`. */
export interface NameFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Labelled single-line input; autocapitalises words and never autocorrects names.
 * @param props - See `NameFieldProps`.
 * @returns The field.
 */
export function NameField({ id, label, value, onChange, placeholder }: NameFieldProps) {
  return (
    <div className="name-field">
      <label className="name-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="name-field__input"
        type="text"
        autoComplete="off"
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
