// Guides on the phone (`/guides`, MyWay): one row per guide with its first step photo, title, the
// V33 line ("6 steps · 2:04 clip", "Making… circling the controls") and its badge. A row
// opens the guide. Guides are made from a clip's page, so the empty state says so.
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { GUIDE_COPY, guideBadge, guideMetaLine } from '../core/guides';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { guidePath, useGuides } from '../hooks/useGuides';
import type { GuideSummary } from '../services/api/types';
import './GuidesPage.css';

function Row({ guide }: { guide: GuideSummary }) {
  const badge = guideBadge(guide);
  return (
    <li>
      <Link className="guides-page__row" to={guidePath(guide.id)}>
        <span className="guides-page__thumb">{guide.cover_url !== null && <img src={guide.cover_url} alt="" loading="lazy" />}</span>
        <span className="guides-page__text">
          <span className="guides-page__title">{guide.title}</span>
          <span className="guides-page__meta">{guideMetaLine(guide)}</span>
        </span>
        <Chip tone={badge.tone}>{badge.label}</Chip>
      </Link>
    </li>
  );
}

/**
 * The page.
 * @returns The Guides list.
 */
export function GuidesPage() {
  const { state, refresh } = useGuides();
  return (
    <div className="guides-page">
      <PageHeader title={GUIDE_COPY.guides} subtitle={GUIDE_COPY.section} />
      {state.status === 'loading' && (
        <div className="guides-page__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading guides…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="guides" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState icon="guides" title={GUIDE_COPY.emptyTitle} body={GUIDE_COPY.emptyBody} />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="guides-page__list">
          {state.data.map((guide) => (
            <Row key={guide.id} guide={guide} />
          ))}
        </ul>
      )}
    </div>
  );
}
