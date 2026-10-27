// The Mac app's Appearance setting (System, Light, Dark); applies at once. Light until the user
// picks another.
import { APPEARANCE_LABEL, APPEARANCES } from '../../core/appearance';
import { SegmentedControl } from '../../design/SegmentedControl';
import { useAppearance } from '../../hooks/useAppearance';
import './AppearanceSetting.css';

const OPTIONS = APPEARANCES.map((value) => ({ value, label: APPEARANCE_LABEL[value] }));

/**
 * The setting row; nothing where the platform has no appearance control.
 * @returns The row, or null.
 */
export function AppearanceSetting() {
  const setting = useAppearance();
  if (setting === null) return null;
  return (
    <div className="appearance-setting">
      <span className="appearance-setting__label" aria-hidden="true">
        Appearance
      </span>
      <SegmentedControl label="Appearance" options={OPTIONS} value={setting.appearance} onChange={setting.setAppearance} />
    </div>
  );
}
