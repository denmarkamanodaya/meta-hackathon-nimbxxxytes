// Puts an image on the system clipboard (the Cut out dialog's Copy): the PNG itself where the
// browser can hold images on the clipboard, else its link.
import type { CopyText } from './copy-text';

/** What ended up on the clipboard. */
export type CopiedAs = 'image' | 'link' | 'failed';

/**
 * Copies the image at a URL.
 * @returns `image`, `link` when only the URL could be copied, or `failed`.
 */
export type CopyImage = (url: string) => Promise<CopiedAs>;

/** The clipboard surface used for images; tests inject a fake. */
export interface ImageClipboard {
  write: (items: ClipboardItem[]) => Promise<void>;
}

/** What the copier needs; each part is absent where the browser lacks it. */
export interface ImageCopierDeps {
  clipboard: ImageClipboard | undefined;
  /** `globalThis.ClipboardItem`. */
  makeItem: ((items: Record<string, Blob>) => ClipboardItem) | undefined;
  /** Reads the image; defaults to the browser's fetch (tests inject one). */
  fetchFn?: typeof fetch;
  /** Copies the link when the image cannot go on the clipboard. */
  copyText: CopyText;
}

/**
 * Builds the copier.
 * @param deps - Clipboard, ClipboardItem, fetch and the text copier.
 * @returns The copier.
 */
export function createImageCopier(deps: ImageCopierDeps): CopyImage {
  const copyLink = async (url: string): Promise<CopiedAs> => ((await deps.copyText(url)) ? 'link' : 'failed');
  return async (url) => {
    const { clipboard, makeItem } = deps;
    if (clipboard === undefined || makeItem === undefined) return copyLink(url);
    try {
      const response = await (deps.fetchFn ?? fetch)(url);
      const blob = await response.blob();
      // Clipboards take PNG only; anything else (a placeholder drawing) goes as its link.
      if (!response.ok || blob.type !== 'image/png') return await copyLink(url);
      await clipboard.write([makeItem({ 'image/png': blob })]);
      return 'image';
    } catch {
      return copyLink(url); // Recovers: fetch or permission refused; the link is the next best thing.
    }
  };
}
