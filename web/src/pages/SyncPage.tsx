// Sync (Mac app only, mock V1 approved 2026-10-27): one status card with "Up to date", how many
// clips and shorts nimbytes holds and when it last checked, the space used on this Mac, what the
// nimbytes drive does, Show in Finder and Sign out; then the Exports line. "Can't reach <server>"
// with Try again shows above it when offline. Live from `sync_status` plus every `sync://status`
// push.
import { syncPanelView, syncProblem, type SyncPanelView } from '../core/desktop-sync';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { LoadError } from '../components/LoadError';
import { useServerUrl, useSyncActions, useSyncStatus } from '../hooks/useDesktop';
import './SyncPage.css';

type Actions = ReturnType<typeof useSyncActions>;

/** The status glyph per tone: a check when up to date, the cloud while busy, else a warning. */
const TONE_ICON = { ok: 'check', busy: 'cloud', warn: 'info', error: 'info', muted: 'info' } as const;

function StatusCard({ view, actions }: { view: SyncPanelView; actions: Actions }) {
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
        Everything is on your <b className="sync-page__strong">nimbytes</b> drive (on your Desktop), but stays in the
        cloud until you open it. nimbytes frees space on its own.
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
    </div>
  );
}
