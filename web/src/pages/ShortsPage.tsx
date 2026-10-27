// Shorts (new tab; not in the Mist mock, built from its cards): every short, newest first, with
// a thumbnail, the prompt, its status and best score. Tapping one opens it.
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { isShortWorking, shortStatusLabel } from '../core/agent-trail';
import { dayLabel } from '../core/day-groups';
import { buttonClassName } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useShortsList } from '../hooks/useOverview';
import type { ShortListItem } from '../services/api/types';
import './ShortsPage.css';

function Row({ short, now }: { short: ShortListItem; now: Date }) {
  const isWorking = isShortWorking(short.status);
  const day = dayLabel(short.created_at, now);
  const drafts = `${String(short.version_count)} ${short.version_count === 1 ? 'draft' : 'drafts'}`;
  return (
    <li>
      <Link className="shorts-row" to={`/editor/${encodeURIComponent(short.short_id)}`}>
        <span className="shorts-row__thumb">{short.thumb_url !== null && <img src={short.thumb_url} alt="" loading="lazy" />}</span>
        <span className="shorts-row__body">
          <span className="shorts-row__prompt">{`“${short.prompt}”`}</span>
          <span className="shorts-row__meta">{[day, short.aspect, drafts].filter(Boolean).join(' · ')}</span>
          <span className="shorts-row__status">
            {isWorking ? (
              <span className="shorts-row__working">
                <Spinner />
                {shortStatusLabel(short.status)}
              </span>
            ) : short.status === 'failed' ? (
              <span className="shorts-row__failed">Stopped</span>
            ) : (
              <span className="shorts-row__ready">Ready</span>
            )}
            {short.best_score !== null && (
              <span className="shorts-row__score">
                {short.best_score}
                <span className="shorts-row__max">/50</span>
              </span>
            )}
          </span>
        </span>
        <Icon name="forward" size="sm" />
      </Link>
    </li>
  );
}

/**
 * The Shorts list.
 * @returns The page.
 */
export function ShortsPage() {
  const { state, refresh } = useShortsList();
  const now = new Date();
  return (
    <div className="shorts-page">
      <PageHeader title="Shorts" subtitle="Every cut the editor made for you, newest first." />
      {state.status === 'loading' && (
        <div className="shorts-page__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading shorts…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="shorts list" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState
          icon="shorts"
          title="No shorts yet"
          body="Pick moments in Search, say what you want to post, and the editor cuts, captions and critiques a draft."
          action={
            <Link to="/search" className={buttonClassName('primary', 'lg')}>
              <Icon name="search" size="sm" />
              Find moments
            </Link>
          }
        />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="shorts-page__list">
          {[...state.data]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((short) => (
              <Row key={short.short_id} short={short} now={now} />
            ))}
        </ul>
      )}
    </div>
  );
}
