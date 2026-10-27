// Button-styled file picker: video clips by default (gallery on iOS, multiple selection), or any
// other file type the caller names.
import { buttonClassName, type ButtonSize, type ButtonVariant } from '../design/Button';
import { Icon } from '../design/Icon';

/** Props for `FilePickerButton`. */
export interface FilePickerButtonProps {
  /** Called with the picked files; never called with an empty list. */
  onPick: (files: File[]) => void;
  /** Visible label. */
  label: string;
  /** Look of the button; defaults to the dashed "add" style. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** File types to offer; defaults to video. */
  accept?: string;
  /** Whether several files can be picked; defaults to true. */
  multiple?: boolean;
}

/**
 * Label wrapping a visually hidden `<input type="file">`, so it stays keyboard reachable.
 * The input is reset after each pick so choosing the same file again fires a change.
 * @param props - See `FilePickerButtonProps`.
 * @returns The picker.
 */
export function FilePickerButton({
  onPick,
  label,
  variant = 'dashed',
  size = 'lg',
  accept = 'video/*',
  multiple = true,
}: FilePickerButtonProps) {
  return (
    <label className={buttonClassName(variant, size)}>
      <Icon name="plus" size="sm" />
      {label}
      <input
        className="visually-hidden"
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onPick(files);
        }}
      />
    </label>
  );
}
