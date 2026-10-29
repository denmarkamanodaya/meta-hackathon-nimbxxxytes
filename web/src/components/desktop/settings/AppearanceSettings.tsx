// Settings › Appearance: Night, Light or Match my Mac as three preview cards (applies at once; a
// saved choice wins over the Night default), then Text size (the whole window zooms, also with
// ⌘+, ⌘− and ⌘0), then Density. Density has no setting behind it yet:
// the Mac app is compact only, so it shows Compact chosen and is disabled.
import type { Appearance } from '../../../core/appearance';
import { TEXT_SIZES, textSizeLabel } from '../../../core/text-size';
import { useAppearance } from '../../../hooks/useAppearance';
import { useIsMacApp } from '../../../hooks/useDesktop';
import { useTextSize } from '../../../hooks/useTextSize';
import { PickGroup, SettingRow, SettingsHeading } from './SettingsParts';

/** The cards, in the mock's order, with the preview each one draws; a browser says "Match system". */
const themes = (isMacApp: boolean): readonly { value: Appearance; label: string; preview: string }[] => [
  { value: 'dark', label: 'Night', preview: 'night' },
  { value: 'light', label: 'Light', preview: 'light' },
  { value: 'system', label: isMacApp ? 'Match my Mac' : 'Match system', preview: 'system' },
];

/** The text-size steps as picks: "85%" … "130%". */
const TEXT_SIZE_OPTIONS = TEXT_SIZES.map((size) => ({ value: String(size), label: textSizeLabel(size) }));

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
  const textSize = useTextSize();
  const isMacApp = useIsMacApp();
  return (
    <>
      <SettingsHeading title="Appearance" />
      <div className="mac-set__block">
        <div className="mac-set__row-title">Theme</div>
        <div className="mac-set__themes" role="group" aria-label="Theme">
          {themes(isMacApp).map((theme) => (
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
      {textSize !== null && (
        <SettingRow title="Text size" hint="Also ⌘+ and ⌘− anywhere; ⌘0 goes back to 100%">
          <PickGroup
            label="Text size"
            options={TEXT_SIZE_OPTIONS}
            value={String(textSize.size)}
            onChange={(value) => {
              textSize.setSize(Number(value));
            }}
          />
        </SettingRow>
      )}
      <SettingRow title="Density" hint="Compact fits more clips on screen">
        <PickGroup label="Density" options={DENSITY} value="compact" disabled onChange={() => undefined} />
      </SettingRow>
    </>
  );
}
