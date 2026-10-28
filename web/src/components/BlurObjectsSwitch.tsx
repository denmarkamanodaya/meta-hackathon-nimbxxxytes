// "Also blur screens and number plates" in the PWA settings sheet (board V20, the switch only),
// over the settings the sheet holds (one copy, so it never sends a stale face-matching value).
import { PRIVACY_COPY } from '../core/copy';
import { SwitchRow } from '../design/SwitchRow';
import type { SettingsHandle } from '../hooks/useOverview';

/**
 * The switch; disabled while the settings load or save.
 * @param props - The settings.
 * @returns The row.
 */
export function BlurObjectsSwitch({ settings }: { settings: SettingsHandle }) {
  const { state, setBlurObjects } = settings;
  const isReady = state.status === 'ready';
  return (
    <SwitchRow
      title={`${PRIVACY_COPY.blurObjects} · ${PRIVACY_COPY.newBadge}`}
      description={state.status === 'error' ? PRIVACY_COPY.unavailable : PRIVACY_COPY.blurObjectsHint}
      checked={isReady && state.blurObjects}
      disabled={!isReady || state.isSaving}
      onChange={(checked) => {
        void setBlurObjects(checked);
      }}
    />
  );
}
