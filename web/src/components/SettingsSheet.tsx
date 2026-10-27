// Settings / About sheet: what the AI cost so far, the opt-in face-matching switch, the Mac app
// download (desktop browsers only, mock M6), how faces are handled, and sign-out.
import { formatUsd } from '../core/format';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { SwitchRow } from '../design/SwitchRow';
import { LogoMark } from '../design/LogoMark';
import { useCosts, useMacDownload, useSignOut } from '../hooks/useAppChrome';
import { useSettings } from '../hooks/useOverview';
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

function FaceMatching() {
  const { state, setFaceMatching } = useSettings();
  const isReady = state.status === 'ready';
  return (
    <SwitchRow
      title="Suggest matching faces"
      description={
        state.status === 'error'
          ? 'Setting not available right now.'
          : 'Compares faces across your own clips to suggest names. Off deletes the face data.'
      }
      checked={isReady && state.faceMatching}
      disabled={!isReady || state.isSaving}
      onChange={(checked) => {
        void setFaceMatching(checked);
      }}
    />
  );
}

/** Props for `SettingsSheet`. */
export interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The sheet; cost data loads only while it is open.
 * @param props - See `SettingsSheetProps`.
 * @returns The sheet.
 */
export function SettingsSheet({ open, onClose }: SettingsSheetProps) {
  const { signOut, isSigningOut } = useSignOut();
  const macDownloadUrl = useMacDownload();
  return (
    <Sheet open={open} onClose={onClose} title="About nimbytes">
      <div className="settings">
        {open && <Costs />}
        {open && <FaceMatching />}
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
