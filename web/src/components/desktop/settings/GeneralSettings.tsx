// Settings › General: the drive folder with Show in Finder, Open at login (the same login item
// as the menu bar icon's "Launch at login"), and Menu bar icon. The menu bar icon is always there,
// so its switch shows on and is disabled.
import { displayFolder } from '../../../core/desktop-sync';
import { Toggle } from '../../../design/Toggle';
import { useOpenAtLogin, useSyncActions, useSyncStatus } from '../../../hooks/useDesktop';
import { SettingRow, SettingsHeading } from './SettingsParts';

/**
 * The section.
 * @returns The section's rows.
 */
export function GeneralSettings() {
  const { state } = useSyncStatus();
  const actions = useSyncActions();
  const login = useOpenAtLogin();
  const folder = displayFolder(state.status === 'ready' ? state.data.folder : '~/nimbytes');
  return (
    <>
      <SettingsHeading title="General" />
      <SettingRow title="Drive folder" hint="Your gallery as files for Finder and editing apps">
        <span className="mac-set__mono">{folder}</span>
        <button type="button" className="mac-set__button" onClick={actions.revealFolder}>
          Show in Finder
        </button>
      </SettingRow>
      <SettingRow title="Open at login" hint="Keeps the drive ready when you start your Mac">
        <Toggle
          checked={login.isEnabled === true}
          disabled={login.isEnabled === null || login.isSaving}
          label="Open at login"
          onChange={(next) => {
            void login.setEnabled(next);
          }}
        />
      </SettingRow>
      <SettingRow title="Menu bar icon" hint="Upload progress and quick open">
        <Toggle checked disabled label="Menu bar icon" onChange={() => undefined} />
      </SettingRow>
    </>
  );
}
