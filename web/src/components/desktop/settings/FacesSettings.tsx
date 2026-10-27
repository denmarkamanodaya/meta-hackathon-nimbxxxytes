// Settings › Faces and privacy: "Suggest matching faces" (the opt-in face-matching setting; off
// deletes the face data), and "Blur hidden faces". Shorts blur hidden faces unless a short's
// Finish step turns it off, and there is no account-wide setting for it yet, so that switch shows
// on and is disabled.
import { Toggle } from '../../../design/Toggle';
import { useSettings } from '../../../hooks/useOverview';
import { SettingRow, SettingsHeading } from './SettingsParts';

/**
 * The section.
 * @returns The section's rows.
 */
export function FacesSettings() {
  const { state, setFaceMatching } = useSettings();
  const isReady = state.status === 'ready';
  return (
    <>
      <SettingsHeading title="Faces and privacy" />
      <SettingRow
        title="Suggest matching faces"
        hint={
          state.status === 'error'
            ? 'Setting not available right now.'
            : 'Compares faces across clips so you name a person once. Off until you turn it on.'
        }
      >
        <Toggle
          checked={isReady && state.faceMatching}
          disabled={!isReady || state.isSaving}
          label="Suggest matching faces"
          onChange={(next) => {
            void setFaceMatching(next);
          }}
        />
      </SettingRow>
      <SettingRow title="Blur hidden faces" hint="Faces you hide in Faces are blurred in previews and every short">
        <Toggle checked disabled label="Blur hidden faces" onChange={() => undefined} />
      </SettingRow>
    </>
  );
}
