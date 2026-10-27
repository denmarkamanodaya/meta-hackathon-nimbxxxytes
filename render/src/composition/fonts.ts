// The brand title fonts, so headless renders draw what the PWA shows. The files are the PWA's own
// self-hosted Latin subsets (copied into render/public; a test keeps the copies identical), served
// by the bundler in a render and by the PWA itself in the Player. Characters outside Latin-1 fall
// back to the next font in the theme's stack.
import { useEffect, useState } from 'react';
import { continueRender, delayRender, staticFile } from 'remotion';

/** One font face to load. */
export interface FontFile {
  family: string;
  /** Path under the public directory. */
  file: string;
  /** CSS weight or weight range. */
  weight: string;
}

/** The faces the brand themes name. */
export const FONT_FILES: readonly FontFile[] = [
  { family: 'Bricolage Grotesque', file: 'fonts/bricolage-grotesque/bricolage-grotesque-700-latin.woff2', weight: '700' },
  { family: 'Geist', file: 'fonts/geist/geist-latin.woff2', weight: '400 600' },
];

let loading: Promise<void> | null = null;

/**
 * Loads every brand face once per page and adds it to the document; later calls share the load.
 * A face that fails to load is skipped (the stack falls back), so this never rejects.
 * @returns Resolves when every face loaded or failed.
 */
export function loadFonts(): Promise<void> {
  loading ??= Promise.all(
    FONT_FILES.map(async (f) => {
      try {
        const face = new FontFace(f.family, `url(${staticFile(f.file)}) format('woff2')`, { weight: f.weight });
        document.fonts.add(await face.load());
      } catch {
        // The theme's stack has fallbacks; a missing face must not stop the render.
      }
    }),
  ).then(() => undefined);
  return loading;
}

/**
 * Holds the frame until the brand faces are loaded, so no frame is drawn in a fallback font.
 */
export function useBrandFonts(): void {
  const [handle] = useState(() => delayRender('Loading the brand fonts'));
  useEffect(() => {
    void loadFonts().then(() => {
      continueRender(handle);
    });
  }, [handle]);
}
