// A letter picker drawn as any button: a real `<button>` (so the kit's `:disabled` and hover
// styles apply) that opens a hidden `<input type="file">`. "Snap a letter" opens the phone's back
// camera (`capture`), "Choose a PDF" the files, and the Mac's "Upload a photo or PDF…" both kinds
// through the same input. iListen's `MediaPicker` opens it for sound files and videos (`media`).
// The input is reset after each pick, so the same file can be picked again.
import { useRef, type ReactNode } from 'react';
import { LISTEN_ACCEPT } from '../core/ilisten/listens';
import { DOCUMENT_ACCEPT } from '../core/iread/documents';

/** What the picker offers. */
export type DocumentPick = 'camera' | 'pdf' | 'any' | 'media';

const ACCEPT: Record<DocumentPick, string> = {
  camera: 'image/*',
  pdf: 'application/pdf',
  any: DOCUMENT_ACCEPT,
  media: LISTEN_ACCEPT,
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
 * @returns The button with its hidden input.
 */
export function DocumentPicker({ pick, onFile, className, isDisabled = false, children }: DocumentPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={isDisabled}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        {children}
      </button>
      <input
        ref={inputRef}
        hidden
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
    </>
  );
}
