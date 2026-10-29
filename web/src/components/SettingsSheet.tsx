// Settings / About sheet: the theme (Night, Light or Auto), what the AI cost so far, the opt-in face-matching switch, the Mac app
// download (desktop browsers only, mock M6), the Brand kit, how faces are handled, and sign-out.
// The Mac app adds its own rows (Appearance) and its own sign-out through the props.
import type { ReactNode } from 'react';
import { formatUsd } from '../core/format';
import type { Appearance } from '../core/appearance';
import { Button } from '../design/Button';
import { SegmentedControl } from '../design/SegmentedControl';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { LogoMark } from '../design/LogoMark';
import { BrandKitRow } from './BrandKitSheet';
import { useCosts, useMacDownload, useSignOut } from '../hooks/useAppChrome';
import { FaceMatchingRow } from './FaceMatchingSwitch';
import { useSettings } from '../hooks/useOverview';
import { useAppearance } from '../hooks/useAppearance';
import { BlurObjectsSwitch } from './BlurObjectsSwitch';
import './SettingsSheet.css';

/** Logo size on the Mac download row (mock M6). */
const MAC_LOGO_PX = 36;

function Costs() {
  const state = useCosts();
  if (state.status === 'loading') {
    return (
      <div className="settings__costs" aria-busy="true">
        <Skeleton kind="title" />
        <Skeleton kind="line" />
      </div>
    );
  }
  if (state.status === 'error') return <p className="settings__muted">{`Cost not available: ${state.message}`}</p>;
  const { total_usd, by_model } = state.data;
  return (
    <div className="settings__costs">
      <p className="settings__total">
        {formatUsd(total_usd)}
        <span className="settings__total-label">spent on AI so far</span>
      </p>
      {by_model.length > 0 && (
        <table className="settings__table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Calls</th>
              <th scope="col">Cost</th>
            </tr>
          </thead>
          <tbody>
            {by_model.map((row) => (
              <tr key={row.model}>
                <td>{row.model}</td>
                <td>{row.calls}</td>
                <td>{formatUsd(row.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Face matching and screens and plates, over one copy of the settings (PUT sends both). */
function PrivacySwitches() {
  const settings = useSettings();
  return (
    <>
      <FaceMatchingRow
        title="Suggest matching faces"
        description="Compares faces across your own clips to suggest names. Off deletes the face data."
        settings={settings}
      />
      <BlurObjectsSwitch settings={settings} />
    </>
  );
}

/** The phone's theme choices: the Mac app's Night and Light, and Auto for the phone's own setting. */
const THEME_OPTIONS: readonly { value: Appearance; label: string }[] = [
  { value: 'dark', label: 'Night' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Auto' },
];

/** Theme: Night (the default, as in the Mac app), Light or Auto; applies at once. */
function ThemeRow() {
  const setting = useAppearance();
  if (setting === null) return null;
  return (
    <div className="settings__theme">
      <span className="settings__theme-label">Theme</span>
      <SegmentedControl label="Theme" options={THEME_OPTIONS} value={setting.appearance} onChange={setting.setAppearance} />
    </div>
  );
}

/** Props for `SettingsSheet`. */
export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's title; "About nimbytes" by default. */
  title?: string;
  /** Platform rows shown above sign-out (the Mac's Appearance). */
  extra?: ReactNode;
  /** A platform sign-out to use instead of the web one (the Mac also clears its Keychain session). */
  signOut?: { signOut: () => Promise<void>; isSigningOut: boolean };
}

/**
 * The sheet; cost data loads only while it is open.
 * @param props - See `SettingsSheetProps`.
 * @returns The sheet.
 */
export function SettingsSheet({ open, onClose, title = 'About nimbytes', extra, signOut: platformSignOut }: SettingsSheetProps) {
  const webSignOut = useSignOut();
  const { signOut, isSigningOut } = platformSignOut ?? webSignOut;
  const macDownloadUrl = useMacDownload();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="settings">
        <ThemeRow />
        {open && <Costs />}
        {open && <PrivacySwitches />}
        <BrandKitRow />
        {macDownloadUrl !== null && (
          <a className="settings__mac" href={macDownloadUrl} target="_blank" rel="noreferrer">
            <span className="settings__mac-text">
              <LogoMark size={MAC_LOGO_PX} />
              <span className="settings__mac-lines">
                <span className="settings__mac-title">nimbytes for Mac</span>
                <span className="settings__mac-sub">Your library as a folder, for Final Cut and Resolve</span>
              </span>
            </span>
            <span className="settings__mac-action">Download</span>
          </a>
        )}
        <p className="settings__privacy">
          Faces are detected per clip. Matching across clips is opt-in, stays in your library, and only suggests.
        </p>
        {extra}
        <Button
          variant="secondary"
          disabled={isSigningOut}
          onClick={() => {
            void signOut().then(onClose);
          }}
        >
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </Sheet>
  );
}
