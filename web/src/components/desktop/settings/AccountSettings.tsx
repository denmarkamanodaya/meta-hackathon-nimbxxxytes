// Settings › Account: the server the app talks to (its host name), the app version, and Sign out
// (which also clears the Keychain session and stops syncing).
import { useAppVersion, useServerUrl, useSyncActions } from '../../../hooks/useDesktop';
import { SettingsHeading } from './SettingsParts';

/**
 * The host of a server URL as the row shows it.
 * @param url - The saved URL.
 * @returns The host, or the text as given when it is not a URL.
 */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url; // Recovers: an unparsable saved value is shown as it is.
  }
}

/** Props for `AccountSettings`. */
export interface AccountSettingsProps {
  /** Called after signing out, so the window closes. */
  onSignedOut: () => void;
}

/**
 * The section.
 * @param props - See `AccountSettingsProps`.
 * @returns The section's rows.
 */
export function AccountSettings({ onSignedOut }: AccountSettingsProps) {
  const server = useServerUrl();
  const version = useAppVersion();
  const { signOut, isSigningOut } = useSyncActions();
  return (
    <>
      <SettingsHeading title="Account" />
      <div className="mac-set__split mac-set__line">
        <span className="mac-set__row-title">Server</span>
        <span className="mac-set__mono">{server == null ? 'Not set' : hostOf(server)}</span>
      </div>
      <div className="mac-set__split mac-set__line">
        <span className="mac-set__row-title">Version</span>
        <span className="mac-set__secondary mac-set__small">{version === null ? 'nimbytes for Mac' : `nimbytes for Mac ${version}`}</span>
      </div>
      <div className="mac-set__foot">
        <button
          type="button"
          className="mac-set__button mac-set__button--quiet mac-set__button--md mac-set__button--danger"
          disabled={isSigningOut}
          onClick={() => {
            void signOut().then(onSignedOut);
          }}
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </>
  );
}
