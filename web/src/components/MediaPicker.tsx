// iListen's picker: a button that opens the files for sound files and videos (the iRead picker
// with `media`).
import type { ReactNode } from 'react';
import { DocumentPicker } from './DocumentPicker';

/** Props for `MediaPicker`. */
export interface MediaPickerProps {
  /** Gets the one picked file. */
  onFile: (file: File) => void;
  className: string;
  isDisabled?: boolean;
  children: ReactNode;
}

/**
 * The picker.
 * @param props - See `MediaPickerProps`.
 * @returns The button with its hidden input.
 */
export function MediaPicker(props: MediaPickerProps) {
  return <DocumentPicker pick="media" {...props} />;
}
