// The Mac app's appearance setting (System, Light or Dark) and the theme it resolves to. Pure:
// the stored value and the system's dark mode come in as arguments.

/** What the user picked. `system` follows macOS. */
export type Appearance = 'system' | 'light' | 'dark';

/** The theme the window draws. */
export type Theme = 'light' | 'dark';

/** The choices, in the order the setting shows them. */
export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/** The label of each choice. */
export const APPEARANCE_LABEL: Readonly<Record<Appearance, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * Reads a stored appearance.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The appearance, or `system` for anything unknown.
 */
export function parseAppearance(raw: string | null): Appearance {
  return APPEARANCES.find((value) => value === raw) ?? 'system';
}

/**
 * Resolves the theme to draw.
 * @param appearance - The user's choice.
 * @param isSystemDark - Whether macOS is in dark mode.
 * @returns `dark` or `light`.
 */
export function resolveTheme(appearance: Appearance, isSystemDark: boolean): Theme {
  if (appearance === 'system') return isSystemDark ? 'dark' : 'light';
  return appearance;
}
