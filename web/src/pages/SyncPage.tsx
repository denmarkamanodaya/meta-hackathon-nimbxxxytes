// Sync (Mac app only, mock M3, server and folder fixed per the 2026-10-27 ruling): status line
// with Sign out and Sync now, and "Can't reach <server>" with Try again when offline; the nimbytes
// folder with Reveal in Finder, what each subfolder holds and the server it syncs with; the smart cache split and its size
// (10 / 20 / 50 GB); files moving now; and edits dropped into Exports/. Live from `sync_status`
// plus every `sync://status` push.
import { CACHE_BUDGET_CHOICES_GB, serverOrigin, syncPanelView, syncProblem, type SyncPanelView } from '../core/desktop-sync';
import { Button } from '../design/Button';
import { SegmentedControl } from '../design/SegmentedControl';
import { Skeleton } from '../design/Skeleton';
import { TransferList } from '../components/desktop/TransferList';
import { LoadError } from '../components/LoadError';
import { useServerUrl, useSyncActions, useSyncStatus } from '../hooks/useDesktop';
import './SyncPage.css';

const BUDGET_OPTIONS = CACHE_BUDGET_CHOICES_GB.map((gb) => ({ value: String(gb), label: `${String(gb)} GB` }));

type Actions = ReturnType<typeof useSyncActions>;

function FolderCard({ view, actions, server }: { view: SyncPanelView; actions: Actions; server: string | null }) {
  return (
    <section className="sync-page__card" aria-label="Folder">
      <h2 className="sync-page__h2">Your nimbytes folder</h2>
      <div className="sync-page__folder">
        <span className="sync-page__path">{view.folder}</span>
        <div className="sync-page__buttons">
          <Button variant="secondary" onClick={actions.revealFolder}>
            Reveal in Finder
          </Button>
        </div>
      </div>
      <dl className="sync-page__counts">
        {view.folderCounts.map((count) => (
          <div key={count.label} className="sync-page__count">
            <dt className="sync-page__muted">{count.label}</dt>
            <dd className="sync-page__count-value">{count.value}</dd>
          </div>
        ))}
      </dl>
      <span className="sync-page__muted">Library, Originals, Shorts and Projects are kept by the app. Only Exports goes up.</span>
      <span className="sync-page__muted">{`Server: ${serverOrigin(server)}`}</span>
    </section>
  );
}

function CacheCard({ view, actions }: { view: SyncPanelView; actions: Actions }) {
  const { cache } = view;
  return (
    <section className="sync-page__card" aria-label="Smart cache">
      <h2 className="sync-page__h2">Smart cache</h2>
      <div className="sync-page__cache-bar" aria-hidden="true">
        <span className="sync-page__cache-kept" style={{ width: `${String(cache.keptPercent)}%` }} />
        <span className="sync-page__cache-cached" style={{ width: `${String(cache.cachedPercent)}%` }} />
      </div>
      <div className="sync-page__legend">
        <span>
          <span className="sync-page__swatch sync-page__swatch--kept" />
          {cache.kept}
        </span>
        <span>
          <span className="sync-page__swatch sync-page__swatch--cached" />
          {cache.cached}
        </span>
      </div>
      <div className="sync-page__budget">
        <span className="sync-page__budget-label">Space for cached originals</span>
        <SegmentedControl
          label="Cache budget"
          options={BUDGET_OPTIONS}
          value={String(cache.budgetGb)}
          onChange={(value) => {
            actions.setCacheBudget(Number(value));
          }}
        />
      </div>
      <span className="sync-page__muted">Kept-offline files are never removed. Cached ones go oldest-first when space runs out.</span>
    </section>
  );
}

function TransfersCard({ view }: { view: SyncPanelView }) {
  return (
    <section className="sync-page__card" aria-label="Transfers">
      <h2 className="sync-page__h2">Transfers</h2>
      <TransferList rows={view.transfers} empty="Nothing moving right now." />
    </section>
  );
}

function ExportsCard({ view }: { view: SyncPanelView }) {
  return (
    <section className="sync-page__card" aria-label="Exports">
      <h2 className="sync-page__h2">
        {'Exports '}
        <span className="sync-page__muted sync-page__h2-note">drop finished edits in ~/nimbytes/Exports</span>
      </h2>
      {view.exports.length === 0 && <span className="sync-page__muted">Nothing dropped yet.</span>}
      {view.exports.map((row) => (
        <div key={row.name} className="sync-page__export">
          <span className="sync-page__export-name">{row.name}</span>
          <span className={`sync-page__export-state sync-page__export-state--${row.tone}`}>
            {row.label}
          </span>
        </div>
      ))}
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
      <div className="sync-page__header">
        <div className="sync-page__heading">
          <h1 className="sync-page__title">Sync</h1>
          {view !== null && (
            <span className="sync-page__headline">
              <span className={`sync-page__dot sync-page__dot--${view.tone}`} aria-hidden="true" />
              {view.headline}
            </span>
          )}
        </div>
        <div className="sync-page__buttons">
          <Button
            variant="secondary"
            disabled={actions.isSigningOut}
            onClick={() => {
              void actions.signOut();
            }}
          >
            {actions.isSigningOut ? 'Signing out…' : 'Sign out'}
          </Button>
          <Button onClick={actions.syncNow}>Sync now</Button>
        </div>
      </div>
      {problem !== null && (
        <div className="sync-page__problem" role="alert">
          <span className="sync-page__problem-text">{problem}</span>
          <Button variant="secondary" onClick={actions.syncNow}>
            Try again
          </Button>
        </div>
      )}
      {state.status === 'loading' && (
        <div aria-busy="true" className="sync-page__grid">
          <p className="visually-hidden" role="status">
            Loading sync status…
          </p>
          <Skeleton kind="video" />
          <Skeleton kind="video" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="sync status" onRetry={reload} />}
      {view !== null && (
        <>
          <div className="sync-page__grid">
            <FolderCard view={view} actions={actions} server={server ?? null} />
            <CacheCard view={view} actions={actions} />
          </div>
          <div className="sync-page__grid">
            <TransfersCard view={view} />
            <ExportsCard view={view} />
          </div>
        </>
      )}
    </div>
  );
}
