// The Productions list (Studio → Productions on the PWA, the Mac sidebar's Productions page): one
// card per production with its first storyboard frame, title, format and status chips, the
// coverage line and bar, and the shots still to film as red chips. "New production" opens the
// brief screen.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PRODUCTION_COPY, PRODUCTION_STATUS_COPY } from '../core/copy';
import { coverageLine, coveragePercent, formatChip, STATUS_TONE } from '../core/production-view';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { ProgressBar } from '../design/ProgressBar';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useProductions } from '../hooks/useProductions';
import type { ProductionListItem } from '../services/api/types';
import { LoadError } from './LoadError';
import './ProductionsList.css';

/** Missing-shot chips a card shows before "+N more". */
const MISSING_CHIPS = 3;

function Card({ item }: { item: ProductionListItem }) {
  const missing = item.missing_titles.slice(0, MISSING_CHIPS);
  const more = item.missing_titles.length - missing.length;
  const isPlanning = item.status === 'planning';
  return (
    <li>
      <Link className="production-card" to={`/productions/${encodeURIComponent(item.production_id)}`}>
        <span className="production-card__cover">
          {item.cover_url !== null && <img src={item.cover_url} alt="" loading="lazy" />}
        </span>
        <span className="production-card__body">
          <span className="production-card__title">{item.title}</span>
          <span className="production-card__chips">
            <Chip>{formatChip(item.format, item.target_s)}</Chip>
            <Chip tone={STATUS_TONE[item.status]}>
              {isPlanning && <Spinner />}
              {PRODUCTION_STATUS_COPY[item.status]}
            </Chip>
          </span>
          {item.shot_count > 0 && (
            <>
              <span className="production-card__coverage">{coverageLine(item.covered_count, item.shot_count)}</span>
              <ProgressBar
                percent={coveragePercent(item.covered_count, item.shot_count)}
                label={`${item.title}: shots covered`}
                tone={item.covered_count === item.shot_count ? 'success' : 'accent'}
              />
            </>
          )}
          {missing.length > 0 && (
            <span className="production-card__missing" aria-label="Still to film">
              {missing.map((title) => (
                <Chip key={title} tone="danger">
                  {title}
                </Chip>
              ))}
              {more > 0 && <Chip tone="danger">{`+${String(more)} more`}</Chip>}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/** Props for `ProductionsView`. */
export interface ProductionsViewProps {
  /** Page title and line under it (the PWA says "Studio"; the Mac page says "Productions"). */
  title: string;
  subtitle?: string;
  /** The Studio's Shorts | Productions switch on the PWA; absent on the Mac. */
  studioSwitch?: ReactNode;
}

/**
 * The page body: header with "New production", the switch, and the list.
 * @param props - See `ProductionsViewProps`.
 * @returns The view.
 */
export function ProductionsView({ title, subtitle, studioSwitch }: ProductionsViewProps) {
  const { state, refresh } = useProductions();
  const newProduction = (
    <Link to="/productions/new" className={`${buttonClassName('primary')} productions__new`}>
      <Icon name="plus" size="sm" />
      {PRODUCTION_COPY.newProduction}
    </Link>
  );
  return (
    <div className="productions">
      <PageHeader title={title} {...(subtitle === undefined ? {} : { subtitle })} trailing={newProduction} />
      {studioSwitch}
      {state.status === 'loading' && (
        <div className="productions__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading productions…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="productions" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState
          icon="sparkle"
          title={PRODUCTION_COPY.emptyTitle}
          body={PRODUCTION_COPY.emptyBody}
          action={
            <Link to="/productions/new" className={buttonClassName('primary', 'lg')}>
              <Icon name="plus" size="sm" />
              {PRODUCTION_COPY.newProduction}
            </Link>
          }
        />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="productions__list">
          {[...state.data]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((item) => (
              <Card key={item.production_id} item={item} />
            ))}
        </ul>
      )}
    </div>
  );
}
