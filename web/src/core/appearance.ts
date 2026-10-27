// The Mac app's appearance setting (System, Light or Dark) and the theme it resolves to. Pure:
// the stored value and the system's dark mode come in as arguments.

/** What the user picked. `system` follows macOS. */
export type Appearance = 'system' | 'light' | 'dark';

/** The theme the window draws. */
export type Theme = 'light' | 'dark';

/** The choices, in the order the setting shows them. */
export const APPEARANCES: readonly Appearance[] = ['system', 'light', 'dark'];

/** The choice before the user picks one: Light (owner ruling 2026-10-27). A saved choice wins. */
export const DEFAULT_APPEARANCE: Appearance = 'light';

/** The label of each choice. */
export const APPEARANCE_LABEL: Readonly<Record<Appearance, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * Reads a stored appearance.
 * @param raw - The stored text, or null when nothing is stored.
 * @returns The appearance, or `DEFAULT_APPEARANCE` (Light) when nothing or something unknown is
 *   stored.
 */
export function parseAppearance(raw: string | null): Appearance {
  return APPEARANCES.find((value) => value === raw) ?? DEFAULT_APPEARANCE;
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
