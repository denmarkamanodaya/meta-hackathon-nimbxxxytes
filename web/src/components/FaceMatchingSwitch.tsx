// The opt-in face-matching switch, wired to the settings API: on the People page (inline, P4) and
// in the settings sheet, each with its own words. The sheet passes the settings it already holds,
// so its switches save one shared copy of the settings.
import { SwitchRow } from '../design/SwitchRow';
import { useSettings, type SettingsHandle } from '../hooks/useOverview';

/** Props for `FaceMatchingSwitch`. */
export interface FaceMatchingSwitchProps {
  title: string;
  description: string;
  /** A second line, such as what turning it off deletes. */
  note?: string;
}

/**
 * The row over settings the caller holds.
 * @param props - The words and the settings.
 * @returns The row.
 */
export function FaceMatchingRow({ title, description, note, settings }: FaceMatchingSwitchProps & { settings: SettingsHandle }) {
  const { state, setFaceMatching } = settings;
  const isReady = state.status === 'ready';
  return (
    <SwitchRow
      title={title}
      description={state.status === 'error' ? 'Setting not available right now.' : description}
      {...(note === undefined || state.status === 'error' ? {} : { note })}
      checked={isReady && state.faceMatching}
      disabled={!isReady || state.isSaving}
      onChange={(checked) => {
        void setFaceMatching(checked);
      }}
    />
  );
}

/**
 * The switch; disabled while the setting loads or saves.
 * @param props - See `FaceMatchingSwitchProps`.
 * @returns The row.
 */
export function FaceMatchingSwitch(props: FaceMatchingSwitchProps) {
  const settings = useSettings();
  return <FaceMatchingRow {...props} settings={settings} />;
}
