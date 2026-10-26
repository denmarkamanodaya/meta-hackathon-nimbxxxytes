// Settings / About sheet: what the AI cost so far, how faces are handled, and sign-out.
import { formatUsd } from '../core/format';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { useCosts, useSignOut } from '../hooks/useAppChrome';
import './SettingsSheet.css';

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
  return (
    <Sheet open={open} onClose={onClose} title="About nimbytes">
      <div className="settings">
        {open && <Costs />}
        <p className="settings__privacy">
          Faces are detected, never recognised; nothing is matched across clips.
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
