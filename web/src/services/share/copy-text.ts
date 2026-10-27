// Puts text on the system clipboard (the Publish screen's "Copy caption").

/**
 * Copies text.
 * @returns True when the text is on the clipboard; false when the browser has no clipboard or
 *   refused (the caller says so).
 */
export type CopyText = (text: string) => Promise<boolean>;

/** The clipboard surface used; tests inject a fake. */
export interface ClipboardTarget {
  writeText: (text: string) => Promise<void>;
}

/**
 * Builds the copier.
 * @param clipboard - `navigator.clipboard`, or undefined where there is none.
 * @returns The copier.
 */
export function createTextCopier(clipboard: ClipboardTarget | undefined): CopyText {
  return async (text) => {
    if (clipboard === undefined) return false;
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false; // Recovers: permission refused; the caller tells the user to copy by hand.
    }
  };
}
