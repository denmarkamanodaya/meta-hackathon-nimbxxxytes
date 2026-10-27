// Settings › General: the drive folder with Show in Finder, then Open at login and Menu bar icon.
// The web layer has no native command for either switch yet (the menu bar icon is always on, and
// Launch at login lives in that icon's menu), so both show their state disabled, with no fake
// behaviour.
import { displayFolder } from '../../../core/desktop-sync';
import { Toggle } from '../../../design/Toggle';
import { useSyncActions, useSyncStatus } from '../../../hooks/useDesktop';
import { SettingRow, SettingsHeading } from './SettingsParts';

/**
 * The section.
 * @returns The section's rows.
 */
export function GeneralSettings() {
  const { state } = useSyncStatus();
  const actions = useSyncActions();
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
        <Toggle checked={false} disabled label="Open at login" onChange={() => undefined} />
      </SettingRow>
      <SettingRow title="Menu bar icon" hint="Upload progress and quick open">
        <Toggle checked disabled label="Menu bar icon" onChange={() => undefined} />
      </SettingRow>
    </>
  );
}
