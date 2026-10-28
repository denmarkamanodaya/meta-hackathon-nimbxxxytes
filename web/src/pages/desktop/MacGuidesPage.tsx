// Guides on the Mac (MyWay, V33): "Guides" and Make a guide… (which opens the Gallery to pick a
// clip; a guide is made from a clip's panel), then one row per guide (first step photo, title, the
// line under it and its badge). A click selects a row for the right column: while it is made,
// "Making “title”" and the stage list; once ready, its first step with Open guide;
// refused or failed, why. A double click or ⏎ opens the guide.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipPanel } from '../../components/desktop/ClipPanel';
import { MacColumns, MacPill } from '../../components/desktop/MacColumns';
import { GuideStages } from '../../components/GuideStages';
import { GuideStepMedia } from '../../components/GuideStepMedia';
import { LoadError } from '../../components/LoadError';
import { fromClipLine, GUIDE_COPY, guideBadge, guideMetaLine, isGuideBusy } from '../../core/guides';
import { formatShortDate } from '../../core/format';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { guidePath, useGuide, useGuides } from '../../hooks/useGuides';
import type { Guide, GuideSummary } from '../../services/api/types';
import './MacGuidesPage.css';

function Row({ guide, isSelected, onSelect }: { guide: GuideSummary; isSelected: boolean; onSelect: () => void }) {
  const navigate = useNavigate();
  const badge = guideBadge(guide);
  return (
    <li>
      <button
        type="button"
        className={isSelected ? 'mac-guides__row mac-guides__row--on' : 'mac-guides__row'}
        aria-pressed={isSelected}
        onClick={onSelect}
        onDoubleClick={() => {
          void navigate(guidePath(guide.id));
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void navigate(guidePath(guide.id));
        }}
      >
        <span className="mac-guides__thumb">{guide.cover_url !== null && <img src={guide.cover_url} alt="" loading="lazy" />}</span>
        <span className="mac-guides__text">
          <span className="mac-guides__title">{guide.title}</span>
          <span className="mac-guides__meta">{guideMetaLine(guide)}</span>
        </span>
        <MacPill tone={badge.tone}>{badge.label}</MacPill>
      </button>
    </li>
  );
}

function ReadyAside({ guide }: { guide: Guide }) {
  const first = guide.steps[0];
  return (
    <>
      {first !== undefined && (
        <>
          <GuideStepMedia step={first} isShowing={false} replayingText="" circledText={null} className="mac-guides__preview" />
          <span className="mac-guides__pv-title">{first.title}</span>
          <span className="mac-guides__pv-text">{first.instruction}</span>
        </>
      )}
      <span className="mac-guides__muted">{`${String(guide.steps.length)} steps · ${fromClipLine(guide.clip_title, guide.clip_duration_s)}`}</span>
      <span className="mac-guides__buttons">
        <Link to={guidePath(guide.id)} className="mac-button mac-button--primary">
          {GUIDE_COPY.openGuide}
        </Link>
      </span>
    </>
  );
}

/** The right column for the selected guide, read in full (its steps and live stage). */
function Selected({ summary }: { summary: GuideSummary }) {
  const { state } = useGuide(summary.id);
  const guide = state.status === 'ready' ? state.data : null;
  const status = guide?.status ?? summary.status;
  return (
    <ClipPanel>
      <div className="mac-guides__aside">
        {isGuideBusy(status) && (
          <>
            <span className="mac-guides__pv-title">{`Making “${summary.title}”`}</span>
            <span className="mac-guides__muted">{`${fromClipLine(summary.clip_title, summary.clip_duration_s)} · about a minute`}</span>
            <GuideStages status={status} stage={guide?.stage ?? summary.stage} />
          </>
        )}
        {status === 'refused' && <span className="mac-guides__muted">{`${GUIDE_COPY.refusedTitle}. ${GUIDE_COPY.refusedBody}`}</span>}
        {status === 'failed' && <span className="mac-guides__muted">{guide?.error ?? summary.error ?? GUIDE_COPY.failedTitle}</span>}
        {status === 'ready' && guide !== null && <ReadyAside guide={guide} />}
        <span className="mac-guides__muted">{`Made ${formatShortDate(summary.created_at, new Date())}`}</span>
      </div>
    </ClipPanel>
  );
}

/**
 * The page (`/guides` in the Mac app).
 * @returns The page.
 */
export function MacGuidesPage() {
  const { state, refresh } = useGuides();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = state.status === 'ready' ? state.data : [];
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const makeGuide = (
    <Link to="/" className="mac-button mac-button--primary">
      <Icon name="plus" size="xs" />
      {GUIDE_COPY.makeGuideMac}
    </Link>
  );
  return (
    <MacColumns
      asideLabel="Selected guide"
      aside={selected === undefined ? undefined : <Selected key={selected.id} summary={selected} />}
    >
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{GUIDE_COPY.guides}</h1>
        <span className="mac-columns__grow" />
        {makeGuide}
      </header>
      {state.status === 'loading' && (
        <div className="mac-guides__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading guides…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="guides" onRetry={refresh} />}
      {state.status === 'ready' && rows.length === 0 && (
        <EmptyState icon="guides" title={GUIDE_COPY.emptyTitle} body={GUIDE_COPY.emptyBody} action={makeGuide} />
      )}
      {rows.length > 0 && (
        <ul className="mac-guides__list">
          {rows.map((guide) => (
            <Row
              key={guide.id}
              guide={guide}
              isSelected={guide.id === selected?.id}
              onSelect={() => {
                setSelectedId(guide.id);
              }}
            />
          ))}
        </ul>
      )}
    </MacColumns>
  );
}
