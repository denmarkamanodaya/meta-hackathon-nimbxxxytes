// Which of the owner's media files exist under public/ (scanned before every run), so a scene can
// draw a labelled placeholder instead of a missing file.
import generated from '../assets.generated.json';

const FILES: Readonly<Record<string, number | null>> = (generated as { files: Record<string, number | null> }).files;

/**
 * Whether a media file is in public/.
 * @param path - Path under public/.
 * @returns True when it was found.
 */
export const hasAsset = (path: string): boolean => path in FILES;

/**
 * The files under a folder matching a prefix, sorted (the hook's b-roll).
 * @param prefix - For example `broll/hook-`.
 * @returns Their paths.
 */
export const assetsStartingWith = (prefix: string): string[] => Object.keys(FILES).filter((path) => path.startsWith(prefix)).sort();
