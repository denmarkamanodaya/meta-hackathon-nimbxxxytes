// Button-styled file picker for video clips (gallery on iOS, multiple selection).
import { buttonClassName } from '../design/Button';
import { Icon } from '../design/Icon';

/** Props for `FilePickerButton`. */
export interface FilePickerButtonProps {
  /** Called with the picked files; never called with an empty list. */
  onPick: (files: File[]) => void;
  /** Visible label. */
  label: string;
}

/**
 * Label wrapping a visually hidden `<input type="file">`, so it stays keyboard reachable.
 * The input is reset after each pick so choosing the same file again fires a change.
 * @param props - See `FilePickerButtonProps`.
 * @returns The picker.
 */
export function FilePickerButton({ onPick, label }: FilePickerButtonProps) {
  return (
    <label className={buttonClassName('primary')}>
      <Icon name="upload" />
      {label}
      <input
        className="visually-hidden"
        type="file"
        accept="video/*"
        multiple
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length > 0) onPick(files);
        }}
      />
    </label>
  );
}
