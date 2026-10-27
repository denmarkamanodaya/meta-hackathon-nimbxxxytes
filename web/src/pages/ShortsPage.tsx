// Studio (P5; on the Mac, "Shorts" under the Studio group, M4): "New short" opens the editor.
// Shorts the editor is still making come first (phone: a card with "Editor is checking draft 2 of
// 3" over a 3-part bar, one part per draft; Mac: the same as a tile overlay). Then every short as
// a 4:5 preview with its status in words ("Ready", "Paused at draft 1 · Resume") and the editor
// score with a bar. Tapping one opens it; its ⋯ menu deletes it. On the Mac a click selects a
// short for the inspector beside the grid and a double-click opens it. The route stays /shorts.
import { useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { EditorScore, ShortStatusBadges } from '../components/ShortBadges';
import { LoadError } from '../components/LoadError';
import { ProductionsView } from '../components/ProductionsList';
import { ShortMenu } from '../components/ShortMenu';
import { StudioSwitch } from '../components/StudioSwitch';
import { isShortWorking } from '../core/agent-trail';
import { STUDIO_COPY } from '../core/copy';
import { formatDuration } from '../core/format';
import { draftStepLabel, editorAtWorkLine, MAX_DRAFTS, workingDraft } from '../core/studio';
import { buttonClassName } from '../design/Button';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { StepBar } from '../design/StepBar';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useShortsList } from '../hooks/useOverview';
import { useStudioView } from '../hooks/useProductions';
import type { ShortListItem } from '../services/api/types';
import './ShortsPage.css';

/** How far into its draft a working short is drawn (the list has no finer progress). */
const HALF = 0.5;

const editorPath = (short: ShortListItem) => `/editor/${encodeURIComponent(short.short_id)}`;

function Thumb({ short, className }: { short: ShortListItem; className: string }) {
  return <span className={className}>{short.thumb_url !== null && <img src={short.thumb_url} alt="" loading="lazy" />}</span>;
}

/** The phone's card for a short the editor is still making. */
function WorkingCard({ short }: { short: ShortListItem }) {
  const working = workingDraft(short.status, short.version_count);
  return (
    <li>
      <Link className="shorts-working" to={editorPath(short)}>
        <Thumb short={short} className="shorts-working__thumb" />
        <span className="shorts-working__body">
          <span className="shorts-tile__title">{`“${short.prompt}”`}</span>
          {working !== null && (
            <>
              <StepBar steps={MAX_DRAFTS} current={working.draft} within={HALF} tone="surface" />
              <span className="short-badges__muted">{editorAtWorkLine(working)}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}

interface TileProps {
  short: ShortListItem;
  isSelected: boolean;
  /** Mac: a click selects (the default is prevented); null on the phone, where a click opens. */
  onSelect: ((short: ShortListItem) => void) | null;
  onDeleted: () => void;
}

function Tile({ short, isSelected, onSelect, onDeleted }: TileProps) {
  const navigate = useNavigate();
  const working = workingDraft(short.status, short.version_count);
  const onClick =
    onSelect === null
      ? undefined
      : (event: MouseEvent<HTMLAnchorElement>) => {
          event.preventDefault();
          onSelect(short);
        };
  return (
    <li className={isSelected ? 'shorts-tile shorts-tile--selected' : 'shorts-tile'}>
      <Link
        className="shorts-tile__link"
        to={editorPath(short)}
        aria-current={isSelected ? 'true' : undefined}
        onClick={onClick}
        onDoubleClick={() => {
          void navigate(editorPath(short));
        }}
      >
        <span className="shorts-tile__preview">
          <Thumb short={short} className="shorts-tile__img" />
          {working === null ? (
            <span className="shorts-tile__duration">{formatDuration(short.target_s)}</span>
          ) : (
            <span className="shorts-tile__overlay">
              <span>{draftStepLabel(working)}</span>
              <StepBar steps={MAX_DRAFTS} current={working.draft} within={HALF} tone="media" />
            </span>
          )}
        </span>
        <span className="shorts-tile__title">{short.prompt}</span>
        {working === null ? <ShortStatusBadges short={short} /> : <span className="short-badges__muted">Editor at work</span>}
        {short.status === 'ready' && short.best_score !== null && <EditorScore score={short.best_score} />}
      </Link>
      <span className="shorts-tile__menu">
        <ShortMenu shortId={short.short_id} actions={[]} onDeleted={onDeleted} tone="overlay" />
      </span>
    </li>
  );
}

/** The first short the Mac inspector shows: the newest ready one, else the newest. */
const firstPick = (shorts: readonly ShortListItem[]) => (shorts.find((short) => short.status === 'ready') ?? shorts[0])?.short_id ?? null;

function Grid({ shorts, refresh }: { shorts: ShortListItem[]; refresh: () => void }) {
  const desktop = useDesktopSlots();
  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = shorts.some((short) => short.short_id === picked) ? picked : firstPick(shorts);
  const selected = shorts.find((short) => short.short_id === selectedId);
  if (desktop === null) {
    const working = shorts.filter((short) => isShortWorking(short.status));
    const done = shorts.filter((short) => !isShortWorking(short.status));
    return (
      <>
        {working.length > 0 && (
          <ul className="shorts-page__working">
            {working.map((short) => (
              <WorkingCard key={short.short_id} short={short} />
            ))}
          </ul>
        )}
        <ul className="shorts-page__grid">
          {done.map((short) => (
            <Tile key={short.short_id} short={short} isSelected={false} onSelect={null} onDeleted={refresh} />
          ))}
        </ul>
      </>
    );
  }
  return (
    <div className="shorts-page__mac">
      <ul className="shorts-page__grid shorts-page__grid--mac">
        {shorts.map((short) => (
          <Tile
            key={short.short_id}
            short={short}
            isSelected={short.short_id === selectedId}
            onSelect={(next) => {
              setPicked(next.short_id);
            }}
            onDeleted={refresh}
          />
        ))}
      </ul>
      {selected !== undefined && <desktop.ShortInspector key={selected.short_id} item={selected} onDeleted={refresh} />}
    </div>
  );
}

/**
 * The Shorts list, under the Studio switch on the PWA.
 * @param props - The switch, absent on the Mac.
 * @returns The list view.
 */
function ShortsView({ studioSwitch }: { studioSwitch?: ReactNode }) {
  const { state, refresh } = useShortsList();
  const isMac = useDesktopSlots() !== null;
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
      {studioSwitch}
      {state.status === 'loading' && (
        <div className="shorts-page__grid" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading shorts…
          </p>
          <Skeleton kind="thumb" />
          <Skeleton kind="thumb" />
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
        <Grid shorts={[...state.data].sort((a, b) => b.created_at.localeCompare(a.created_at))} refresh={refresh} />
      )}
    </div>
  );
}

/**
 * The Studio page: Shorts, or on the PWA the Shorts | Productions switch (remembered for the
 * session). The Mac app reaches Productions from its sidebar.
 * @returns The page.
 */
export function ShortsPage() {
  const isMac = useDesktopSlots() !== null;
  const { view, setView } = useStudioView();
  if (isMac) return <ShortsView />;
  const studioSwitch = <StudioSwitch view={view} onChange={setView} />;
  return view === 'productions' ? (
    <ProductionsView title={STUDIO_COPY.name} studioSwitch={studioSwitch} />
  ) : (
    <ShortsView studioSwitch={studioSwitch} />
  );
}
