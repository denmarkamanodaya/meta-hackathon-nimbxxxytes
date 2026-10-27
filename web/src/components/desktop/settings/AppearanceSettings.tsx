// Settings › Appearance: Night, Light or Match my Mac as three preview cards (applies at once; a
// saved choice wins over the Night default), then Density. Density has no setting behind it yet:
// the Mac app is compact only, so it shows Compact chosen and is disabled.
import type { Appearance } from '../../../core/appearance';
import { useAppearance } from '../../../hooks/useAppearance';
import { PickGroup, SettingRow, SettingsHeading } from './SettingsParts';

/** The cards, in the mock's order, with the preview each one draws. */
const THEMES: readonly { value: Appearance; label: string; preview: string }[] = [
  { value: 'dark', label: 'Night', preview: 'night' },
  { value: 'light', label: 'Light', preview: 'light' },
  { value: 'system', label: 'Match my Mac', preview: 'system' },
];

const DENSITY = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
] as const;

/**
 * The section.
 * @returns The section's rows.
 */
export function AppearanceSettings() {
  const setting = useAppearance();
  return (
    <>
      <SettingsHeading title="Appearance" />
      <div className="mac-set__block">
        <div className="mac-set__row-title">Theme</div>
        <div className="mac-set__themes" role="group" aria-label="Theme">
          {THEMES.map((theme) => (
            <button
              key={theme.value}
              type="button"
              className="mac-set__theme"
              aria-pressed={setting?.appearance === theme.value}
              disabled={setting === null}
              onClick={() => {
                setting?.setAppearance(theme.value);
              }}
            >
              <span className={`mac-set__theme-card mac-set__theme-card--${theme.preview}`} aria-hidden="true" />
              {theme.label}
            </button>
          ))}
        </div>
      </div>
      <SettingRow title="Density" hint="Compact fits more clips on screen">
        <PickGroup label="Density" options={DENSITY} value="compact" disabled onChange={() => undefined} />
      </SettingRow>
    </>
  );
}
