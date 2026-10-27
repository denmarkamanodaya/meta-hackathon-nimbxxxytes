// The opt-in face-matching switch, wired to the settings API: on the People page (inline, P4) and
// in the settings sheet, each with its own words.
import { SwitchRow } from '../design/SwitchRow';
import { useSettings } from '../hooks/useOverview';

/** Props for `FaceMatchingSwitch`. */
export interface FaceMatchingSwitchProps {
  title: string;
  description: string;
  /** A second line, such as what turning it off deletes. */
  note?: string;
}

/**
 * The switch; disabled while the setting loads or saves.
 * @param props - See `FaceMatchingSwitchProps`.
 * @returns The row.
 */
export function FaceMatchingSwitch({ title, description, note }: FaceMatchingSwitchProps) {
  const { state, setFaceMatching } = useSettings();
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
