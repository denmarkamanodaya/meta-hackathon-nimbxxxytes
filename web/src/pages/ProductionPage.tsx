// A production (`/productions/:id`): the dark coverage header, the live plan progress while the
// planner runs, the shots grouped by act (storyboard frame, title, direction, Covered with the
// matched moment or Missing with "How to film"), and a bottom bar to film what is missing or cut
// the story. A stopped plan shows why and Retry.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { LoadError } from '../components/LoadError';
import { PRODUCTION_COPY, PRODUCTION_STATUS_COPY } from '../core/copy';
import {
  actLabel,
  coveragePercent,
  formatChip,
  groupByAct,
  planProgress,
  timeRange,
} from '../core/production-view';
import { BottomBar } from '../design/BottomBar';
import { Button, buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { ProgressBar } from '../design/ProgressBar';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useProduction } from '../hooks/useProduction';
import type { ProductionDetail, ProductionShot, StudioStepEvent } from '../services/api/types';
import './ProductionPage.css';

function CoveragePanel({ detail, onRecheck }: { detail: ProductionDetail; onRecheck: () => void }) {
  const total = detail.shots.length;
  return (
    <section className="coverage-panel" aria-label="Coverage">
      <div className="coverage-panel__row">
        <span className="coverage-panel__label">Coverage</span>
        <Button variant="ghost" disabled={detail.busy} onClick={onRecheck}>
          Check again
        </Button>
      </div>
      <p className="coverage-panel__count">
        <span className="coverage-panel__number">{`${String(detail.covered_count)} / ${String(total)}`}</span> shots
      </p>
      <ProgressBar percent={coveragePercent(detail.covered_count, total)} label="Shots covered" />
      <p className="coverage-panel__note">{PRODUCTION_COPY.coverageNote}</p>
    </section>
  );
}

function PlanProgress({ event }: { event: StudioStepEvent | null }) {
  const progress = planProgress(event ?? { step: 'planning', status: 'running' });
  return (
    <section className="plan-progress" aria-label="Planning">
      <p className="plan-progress__line" role="status">
        <Spinner />
        {progress.label}
      </p>
      {progress.fraction !== null && <ProgressBar percent={Math.round(progress.fraction * 100)} label="Storyboards drawn" />}
    </section>
  );
}

function Stopped({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <section className="plan-stopped" role="alert">
      <p className="plan-stopped__title">{PRODUCTION_COPY.planFailed}</p>
      {error !== null && <p className="plan-stopped__why">{error}</p>}
      <Button variant="secondary" onClick={onRetry}>
        {PRODUCTION_COPY.retry}
      </Button>
    </section>
  );
}

interface ShotCardProps {
  shot: ProductionShot;
  aspect: string;
  /** The plan is still being made: coverage has not been checked yet. */
  isPlanning: boolean;
  onHowTo: () => void;
}

function ShotCard({ shot, aspect, isPlanning, onHowTo }: ShotCardProps) {
  const match = shot.match;
  return (
    <li className="shot-card">
      <span className={`shot-card__board shot-card__board--${aspect === '1:1' ? 'square' : 'portrait'}`}>
        {shot.board_url === null ? (
          <span className="shot-card__drawing">
            <Spinner />
            <span className="visually-hidden">Drawing the storyboard</span>
          </span>
        ) : (
          <img src={shot.board_url} alt={`Storyboard: ${shot.title}`} loading="lazy" />
        )}
        <span className="shot-card__number" aria-hidden="true">
          {shot.ord}
        </span>
      </span>
      <div className="shot-card__body">
        <h3 className="shot-card__title">
          <span className="visually-hidden">{`Shot ${String(shot.ord)}: `}</span>
          {shot.title}
        </h3>
        <p className="shot-card__direction">{shot.direction}</p>
        {isPlanning ? null : match === null ? (
          <div className="shot-card__status">
            <Chip tone="danger">{PRODUCTION_COPY.missing}</Chip>
            <Button variant="secondary" onClick={onHowTo}>
              {PRODUCTION_COPY.howToFilm}
            </Button>
          </div>
        ) : (
          <div className="shot-card__match">
            <Chip tone="success">
              <Icon name="check" size="xs" />
              {PRODUCTION_COPY.covered}
            </Chip>
            <Link className="shot-card__moment" to={`/clips/${encodeURIComponent(match.clip_id)}`}>
              <img className="shot-card__thumb" src={match.thumb_url} alt="" loading="lazy" />
              <span className="shot-card__moment-text">
                <span className="shot-card__moment-desc">{match.description}</span>
                <span className="shot-card__moment-meta">
                  {[
                    match.clip_title,
                    timeRange(match.start_s, match.end_s),
                    shot.take_count > 1 ? `${String(shot.take_count)} takes` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </Link>
          </div>
        )}
      </div>
    </li>
  );
}

function HowToSheet({ shot, onClose }: { shot: ProductionShot | null; onClose: () => void }) {
  return (
    <Sheet open={shot !== null} onClose={onClose} title={shot === null ? PRODUCTION_COPY.howToFilm : `How to film: ${shot.title}`}>
      {shot !== null && (
        <div className="how-to">
          <p className="how-to__direction">{shot.direction}</p>
          {shot.tips.length > 0 && (
            <ul className="how-to__tips">
              {shot.tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          )}
          <p className="how-to__length">{`About ${String(Math.round(shot.duration_s))} seconds in the cut.`}</p>
        </div>
      )}
    </Sheet>
  );
}

function Loading() {
  return (
    <div className="production-page" aria-busy="true">
      <BackHeader title="Production" subtitle="" fallback="/shorts" />
      <p className="visually-hidden" role="status">
        Loading the production…
      </p>
      <Skeleton kind="video" />
      <Skeleton kind="line" />
    </div>
  );
}

/**
 * Shows one production by route id.
 * @returns The page.
 */
export function ProductionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isMac = useDesktopSlots() !== null;
  const fallback = isMac ? '/productions' : '/shorts';
  const { state, progress, refresh, recheck, retry, cut, isCutting } = useProduction(id);
  const [howTo, setHowTo] = useState<ProductionShot | null>(null);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <div className="production-page">
        <BackHeader title="Production" subtitle="" fallback={fallback} />
        <LoadError error={state.error} thing="production" onRetry={refresh} />
      </div>
    );
  }

  const detail = state.data;
  const p = detail.production;
  const isPlanning = p.status === 'planning';
  const subtitle = [formatChip(p.format, p.target_s), p.aspect, PRODUCTION_STATUS_COPY[p.status]].join(' · ');
  const storyId = p.short_id;

  return (
    <div className="production-page">
      <BackHeader title={p.title} subtitle={subtitle} fallback={fallback} />
      {p.status === 'failed' && <Stopped error={p.error} onRetry={() => void retry()} />}
      {detail.shots.length > 0 && !isPlanning && <CoveragePanel detail={detail} onRecheck={() => void recheck()} />}
      {(isPlanning || detail.busy) && <PlanProgress event={progress} />}
      {groupByAct(detail.shots).map((group) => (
        <section key={group.act} className="act-group" aria-label={actLabel(group.act)}>
          <h2 className="act-group__label">{actLabel(group.act)}</h2>
          <ul className="act-group__shots">
            {group.shots.map((shot) => (
              <ShotCard
                key={shot.shot_id}
                shot={shot}
                aspect={p.aspect}
                isPlanning={isPlanning}
                onHowTo={() => {
                  setHowTo(shot);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
      <HowToSheet
        shot={howTo}
        onClose={() => {
          setHowTo(null);
        }}
      />
      <BottomBar>
        <Link to="/upload" className={buttonClassName('secondary', 'lg')}>
          {PRODUCTION_COPY.filmMissing}
        </Link>
        {storyId === null ? (
          <Button
            size="lg"
            disabled={!detail.can_cut || isCutting || isPlanning}
            onClick={() => {
              void cut().then((shortId) => {
                if (shortId !== null) void navigate(`/editor/${encodeURIComponent(shortId)}`);
              });
            }}
          >
            {isCutting && <Spinner />}
            {PRODUCTION_COPY.cutStory}
          </Button>
        ) : (
          <Link to={`/editor/${encodeURIComponent(storyId)}`} className={buttonClassName('primary', 'lg')}>
            {PRODUCTION_COPY.openStory}
          </Link>
        )}
      </BottomBar>
    </div>
  );
}
