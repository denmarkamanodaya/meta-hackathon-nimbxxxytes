// Sync (Mac app only, mock V1 approved 2026-10-27): one status card with "Up to date", how many
// clips and shorts nimbytes holds and when it last checked, the space used on this Mac, where the
// drive is (`~/nimbytes`) and what it does, Show in Finder and Sign out; then the Exports line. "Can't reach <server>"
// with Try again shows above it when offline. Live from `sync_status` plus every `sync://status`
// push. Last, the Appearance setting (System, Light, Dark), which applies at once.
import { APPEARANCE_LABEL, APPEARANCES } from '../core/appearance';
import { macDriveLine } from '../core/copy';
import { syncPanelView, syncProblem, type SyncPanelView } from '../core/desktop-sync';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { SegmentedControl } from '../design/SegmentedControl';
import { Skeleton } from '../design/Skeleton';
import { LoadError } from '../components/LoadError';
import { useAppearance } from '../hooks/useAppearance';
import { useServerUrl, useSyncActions, useSyncStatus } from '../hooks/useDesktop';
import './SyncPage.css';

type Actions = ReturnType<typeof useSyncActions>;

/** The status glyph per tone: a check when up to date, the cloud while busy, else a warning. */
const TONE_ICON = { ok: 'check', busy: 'cloud', warn: 'info', error: 'info', muted: 'info' } as const;

const APPEARANCE_OPTIONS = APPEARANCES.map((value) => ({ value, label: APPEARANCE_LABEL[value] }));

function AppearanceSetting() {
  const setting = useAppearance();
  if (setting === null) return null;
  return (
    <div className="sync-page__appearance">
      <span className="sync-page__sub" aria-hidden="true">
        Appearance
      </span>
      <SegmentedControl
        label="Appearance"
        options={APPEARANCE_OPTIONS}
        value={setting.appearance}
        onChange={setting.setAppearance}
      />
    </div>
  );
}

function StatusCard({ view, actions }: { view: SyncPanelView; actions: Actions }) {
  const drive = macDriveLine(view.folder);
  return (
    <section className="sync-page__card" aria-label="Sync status">
      <div className="sync-page__status">
        <span className={`sync-page__status-icon sync-page__status-icon--${view.tone}`} aria-hidden="true">
          <Icon name={TONE_ICON[view.tone]} size="md" />
        </span>
        <div className="sync-page__status-text">
          <span className="sync-page__status-title" role="status">
            {view.title}
          </span>
          <span className="sync-page__sub">{view.line}</span>
        </div>
      </div>
      <div className="sync-page__space">
        <span className="sync-page__space-label">Space used on this Mac</span>
        <span className="sync-page__space-value">{view.spaceUsed}</span>
      </div>
      <p className="sync-page__explain">
        {drive.before}
        <b className="sync-page__strong">{drive.folder}</b>
        {drive.after}
      </p>
      <div className="sync-page__buttons">
        <Button onClick={actions.revealFolder}>Show in Finder</Button>
        <Button
          variant="secondary"
          disabled={actions.isSigningOut}
          onClick={() => {
            void actions.signOut();
          }}
        >
          {actions.isSigningOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </section>
  );
}

/**
 * The Sync page.
 * @returns The page.
 */
export function SyncPage() {
  const { state, reload } = useSyncStatus();
  const actions = useSyncActions();
  const server = useServerUrl();
  const view = state.status === 'ready' ? syncPanelView(state.data, new Date()) : null;
  const problem = state.status === 'ready' ? syncProblem(state.data.state, server ?? null, state.data.error) : null;
  return (
    <div className="sync-page">
      <h1 className="sync-page__title">Sync</h1>
      {problem !== null && (
        <div className="sync-page__problem" role="alert">
          <span className="sync-page__problem-text">{problem}</span>
          <Button variant="secondary" onClick={actions.syncNow}>
            Try again
          </Button>
        </div>
      )}
      {state.status === 'loading' && (
        <div aria-busy="true" className="sync-page__card">
          <p className="visually-hidden" role="status">
            Loading sync status…
          </p>
          <Skeleton kind="title" />
          <Skeleton kind="line" />
          <Skeleton kind="line-short" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="sync status" onRetry={reload} />}
      {view !== null && <StatusCard view={view} actions={actions} />}
      <span className="sync-page__sub">Edits you save to nimbytes › Exports upload to your library automatically.</span>
      <AppearanceSetting />
    </div>
  );
}
