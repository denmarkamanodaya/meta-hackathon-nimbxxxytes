// Guides on the Mac (V33): "Guides" with its count, or with no guides an empty state whose Make a
// guide… opens the Gallery to pick a clip (a guide is made from a clip's panel); then one row per guide (first step photo, title, the
// line under it and its badge). A click selects a row for the right column: while it is made,
// "Making “title”" and the stage list; once ready, its title, then its first step and Open guide;
// refused or failed, why. A double click or ⏎ opens the guide. A right-click on a made guide
// opens Rename guide… / Delete guide… in place of the webview's own menu.
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipPanel } from '../../components/desktop/ClipPanel';
import { MacColumns, MacPill } from '../../components/desktop/MacColumns';
import { guideMenuItems, MacGuideDialogs, type GuideAsk } from '../../components/desktop/MacGuideOptions';
import { GuideStages } from '../../components/GuideStages';
import { GuideStepMedia } from '../../components/GuideStepMedia';
import { LoadError } from '../../components/LoadError';
import { fromClipLine, GUIDE_COPY, guideBadge, guideCount, guideMetaLine, isGuideBusy } from '../../core/guides';
import { formatShortDate } from '../../core/format';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { guidePath, useGuide, useGuides } from '../../hooks/useGuides';
import { useMenu } from '../../hooks/useMenu';
import type { Guide, GuideSummary } from '../../services/api/types';
import './MacGuidesPage.css';

interface RowProps {
  guide: GuideSummary;
  isSelected: boolean;
  onSelect: () => void;
  /** Opens the rename sheet or the delete confirm. */
  onAsk: (ask: GuideAsk) => void;
}

function Row({ guide, isSelected, onSelect, onAsk }: RowProps) {
  const navigate = useNavigate();
  const menu = useMenu();
  const badge = guideBadge(guide);
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // A guide still being made has no actions yet, but the webview's own menu stays away.
    if (isGuideBusy(guide.status)) event.preventDefault();
    else menu.openAtPointer(event);
  };
  return (
    <li onContextMenu={onContextMenu}>
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
      <Menu anchor={menu.anchor} label={guide.title} onClose={menu.close} className="mac-menu--narrow" items={guideMenuItems({ guideId: guide.id, title: guide.title }, onAsk)} />
    </li>
  );
}

function ReadyAside({ guide }: { guide: Guide }) {
  const first = guide.steps[0];
  return (
    <>
      <h2 className="mac-guides__pv-title">{guide.title}</h2>
      <span className="mac-guides__muted">{`${String(guide.steps.length)} steps · ${fromClipLine(guide.clip_title, guide.clip_duration_s)}`}</span>
      {first !== undefined && (
        <>
          <GuideStepMedia step={first} isPlaying={false} replayingText="" circledText={null} className="mac-guides__preview" />
          <span className="mac-guides__pv-step">{`Step 1 · ${first.title}`}</span>
          <span className="mac-guides__pv-text">{first.instruction}</span>
        </>
      )}
      <span className="mac-guides__buttons">
        <Link to={guidePath(guide.id)} className="mac-button">
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
  const [ask, setAsk] = useState<GuideAsk>(null);
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
        {state.status === 'ready' && rows.length > 0 && <span className="mac-columns__sub">{guideCount(rows.length)}</span>}
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
              onAsk={setAsk}
            />
          ))}
        </ul>
      )}
      <MacGuideDialogs
        ask={ask}
        onClose={() => {
          setAsk(null);
        }}
        onRenamed={refresh}
        onDeleted={refresh}
      />
    </MacColumns>
  );
}
