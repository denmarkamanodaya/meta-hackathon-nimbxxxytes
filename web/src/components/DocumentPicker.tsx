// A letter picker drawn as any button: a label around a visually hidden `<input type="file">`, so
// it stays keyboard reachable. "Snap a letter" opens the phone's back camera (`capture`), "Choose a
// PDF" the files, and the Mac's "Upload a photo or PDF…" both kinds through the same input. The
// input is reset after each pick, so the same file can be picked again.
import type { ReactNode } from 'react';
import { DOCUMENT_ACCEPT } from '../core/iread/documents';

/** What the picker offers. */
export type DocumentPick = 'camera' | 'pdf' | 'any';

const ACCEPT: Record<DocumentPick, string> = {
  camera: 'image/*',
  pdf: 'application/pdf',
  any: DOCUMENT_ACCEPT,
};

/** Props for `DocumentPicker`. */
export interface DocumentPickerProps {
  pick: DocumentPick;
  /** Gets the one picked file. */
  onFile: (file: File) => void;
  className: string;
  isDisabled?: boolean;
  children: ReactNode;
}

/**
 * The picker.
 * @param props - See `DocumentPickerProps`.
 * @returns The label with its input.
 */
export function DocumentPicker({ pick, onFile, className, isDisabled = false, children }: DocumentPickerProps) {
  return (
    <label className={className} aria-disabled={isDisabled || undefined}>
      {children}
      <input
        className="visually-hidden"
        type="file"
        accept={ACCEPT[pick]}
        {...(pick === 'camera' ? { capture: 'environment' as const } : {})}
        disabled={isDisabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) onFile(file);
        }}
      />
    </label>
  );
}
