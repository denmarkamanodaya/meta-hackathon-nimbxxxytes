// The Mac app's text size: the steps the setting offers, stepping up and down, and which keys
// change it (⌘ or Ctrl with + or =, −, and 0 to reset). Pure: the stored value and the key event
// come in as arguments.

/** The steps, smallest first; 1 is 100%. The window's 1200 px minimum still fits the top step. */
export const TEXT_SIZES: readonly number[] = [0.85, 0.9, 1, 1.1, 1.2, 1.3];

/** The size before the user picks one. */
export const DEFAULT_TEXT_SIZE = 1;

/**
 * Reads a stored size.
 * @param raw - The stored text, or null.
 * @returns One of `TEXT_SIZES`, or the default for anything else.
 */
export function parseTextSize(raw: string | null): number {
  const size = Number(raw);
  return raw !== null && TEXT_SIZES.includes(size) ? size : DEFAULT_TEXT_SIZE;
}

/**
 * The next step up or down, held at the ends.
 * @param current - The size now.
 * @param step - +1 bigger, -1 smaller.
 * @returns The new size.
 */
export function stepTextSize(current: number, step: 1 | -1): number {
  const index = TEXT_SIZES.indexOf(current);
  const from = index === -1 ? TEXT_SIZES.indexOf(DEFAULT_TEXT_SIZE) : index;
  const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, from + step));
  return TEXT_SIZES[next] ?? DEFAULT_TEXT_SIZE;
}

/**
 * "110%".
 * @param size - The size.
 * @returns The percent.
 */
export const textSizeLabel = (size: number): string => `${String(Math.round(size * 100))}%`;

/** What a text-size key asks for. */
export type TextSizeKey = 'up' | 'down' | 'reset';

/** The parts of a key event the rule reads. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

/**
 * Whether a key press changes the text size.
 * @param event - The key event.
 * @returns `up` for ⌘/Ctrl with + or =, `down` with - or _, `reset` with 0; else null.
 */
export function textSizeKey(event: KeyLike): TextSizeKey | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === '+' || event.key === '=') return 'up';
  if (event.key === '-' || event.key === '_') return 'down';
  if (event.key === '0') return 'reset';
  return null;
}
