// Studio (P5; on the Mac, "Shorts" under the Studio group, M4): every short, newest first, with a
// thumbnail, the prompt, its status in words and the editor score with a 5-part bar. "New short"
// opens the editor. A short the editor stopped reads "Paused at draft N · Resume" (it opens on that
// draft). Tapping one opens it; its ⋯ menu deletes it. The route stays /shorts.
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { ShortMenu } from '../components/ShortMenu';
import { isShortWorking, SCORE_MAX, SCORE_PARTS, scoreParts, shortStatusLabel, stoppedShort } from '../core/agent-trail';
import { editorScoreLabel, pausedAtDraft, STUDIO_COPY } from '../core/copy';
import { dayLabel } from '../core/day-groups';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useShortsList } from '../hooks/useOverview';
import type { ShortListItem } from '../services/api/types';
import './ShortsPage.css';

function Status({ short }: { short: ShortListItem }) {
  if (isShortWorking(short.status)) {
    return (
      <span className="shorts-row__working">
        <Spinner />
        {shortStatusLabel(short.status)}
      </span>
    );
  }
  if (short.status === 'ready') {
    return (
      <Chip tone="success">
        <Icon name="check" size="xs" />
        {STUDIO_COPY.ready}
      </Chip>
    );
  }
  const stopped = stoppedShort(short.version_count);
  if (!stopped.canResume) return <Chip tone="warning">{STUDIO_COPY.stoppedBeforeDraft}</Chip>;
  return (
    <>
      <Chip tone="warning">{pausedAtDraft(stopped.draft)}</Chip>
      <span className="shorts-row__resume">{STUDIO_COPY.resume}</span>
    </>
  );
}

function Score({ score }: { score: number }) {
  const lit = scoreParts(score);
  return (
    <span className="shorts-row__score">
      <span className="shorts-row__score-bar" aria-hidden="true">
        {Array.from({ length: SCORE_PARTS }, (_, index) => (
          <span key={index} className={index < lit ? 'shorts-row__score-part shorts-row__score-part--on' : 'shorts-row__score-part'} />
        ))}
      </span>
      {editorScoreLabel(score, SCORE_MAX)}
    </span>
  );
}

function Row({ short, now, onDeleted }: { short: ShortListItem; now: Date; onDeleted: () => void }) {
  const day = dayLabel(short.created_at, now);
  const drafts = `${String(short.version_count)} ${short.version_count === 1 ? 'draft' : 'drafts'}`;
  return (
    <li className="shorts-item">
      <Link className="shorts-row" to={`/editor/${encodeURIComponent(short.short_id)}`}>
        <span className="shorts-row__thumb">{short.thumb_url !== null && <img src={short.thumb_url} alt="" loading="lazy" />}</span>
        <span className="shorts-row__body">
          <span className="shorts-row__prompt">{`“${short.prompt}”`}</span>
          <span className="shorts-row__meta">{[day, short.aspect, drafts].filter(Boolean).join(' · ')}</span>
          <span className="shorts-row__status">
            <Status short={short} />
          </span>
          {short.best_score !== null && <Score score={short.best_score} />}
        </span>
      </Link>
      <ShortMenu shortId={short.short_id} actions={[]} onDeleted={onDeleted} />
    </li>
  );
}

/**
 * The Studio page (the Shorts list).
 * @returns The page.
 */
export function ShortsPage() {
  const { state, refresh } = useShortsList();
  const isMac = useDesktopSlots() !== null;
  const now = new Date();
  const newShort = (
    <Link to="/editor" className={`${buttonClassName('primary')} shorts-page__new`}>
      <Icon name="sparkle" size="sm" />
      {STUDIO_COPY.newShort}
    </Link>
  );
  return (
    <div className="shorts-page">
      {isMac ? (
        <PageHeader title={STUDIO_COPY.shorts} subtitle={STUDIO_COPY.macSubtitle} trailing={newShort} />
      ) : (
        <PageHeader title={STUDIO_COPY.name} trailing={newShort} />
      )}
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
              <Row key={short.short_id} short={short} now={now} onDeleted={refresh} />
            ))}
        </ul>
      )}
    </div>
  );
}
