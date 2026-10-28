// Settings › Faces and privacy: "Suggest matching faces" (the opt-in face-matching setting; off
// deletes the face data), "Blur hidden faces", and "Also blur screens and number plates" (board
// V20) with its New badge and a preview of what it does to a short. Shorts blur hidden faces unless a short's
// Finish step turns it off, and there is no account-wide setting for it yet, so that switch shows
// on and is disabled.
import { PRIVACY_COPY } from '../../../core/copy';
import { Toggle } from '../../../design/Toggle';
import { useSettings, type SettingsState } from '../../../hooks/useOverview';
import { SettingRow, SettingsHeading } from './SettingsParts';

/** The screens and plates switch as shown: off until the settings load. */
const isReadyOn = (state: SettingsState) => state.status === 'ready' && state.blurObjects;

/**
 * The section.
 * @returns The section's rows.
 */
export function FacesSettings() {
  const { state, setFaceMatching, setBlurObjects } = useSettings();
  const blurObjects = isReadyOn(state);
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
      <SettingRow
        title={
          <span className="mac-set__badged">
            {PRIVACY_COPY.blurObjects}
            <span className="mac-set__new">{PRIVACY_COPY.newBadge}</span>
          </span>
        }
        hint={state.status === 'error' ? PRIVACY_COPY.unavailable : PRIVACY_COPY.blurObjectsHint}
      >
        <Toggle
          checked={blurObjects}
          disabled={!isReady || state.isSaving}
          label={PRIVACY_COPY.blurObjects}
          onChange={(next) => {
            void setBlurObjects(next);
          }}
        />
      </SettingRow>
      <div className="mac-set__privacy">
        <figure className="mac-set__privacy-figure">
          <span className={blurObjects ? 'privacy-scene privacy-scene--blurred' : 'privacy-scene'} aria-hidden="true">
            <span className="privacy-scene__road" />
            <span className="privacy-scene__car" />
            <span className="privacy-scene__plate">{PRIVACY_COPY.plate}</span>
            <span className="privacy-scene__laptop" />
            <span className="privacy-scene__screen" />
          </span>
          <figcaption className="mac-set__hint">{blurObjects ? PRIVACY_COPY.blurredCaption : PRIVACY_COPY.readableCaption}</figcaption>
        </figure>
        <div className="mac-set__privacy-notes">
          <span>{PRIVACY_COPY.foundBy}</span>
          <span className="mac-set__hint">{PRIVACY_COPY.cost}</span>
        </div>
      </div>
    </>
  );
}
