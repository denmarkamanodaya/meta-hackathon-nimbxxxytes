// Productions on the Mac (redesign v2, V10a/b, key art V17): one compact row per production (its
// key art, else its first storyboard frame; title with format and status pills, "Created 28 Oct
// 2026 · short cut", the coverage line over a slim bar, "To film: <shot>" and ⋯). A click selects
// a row for the right column (its key art, New art, Use as cover, Open production); a double
// click or ⏎ opens it. ⋯ or a right-click opens Open (⏎), Open its short and Delete production…
// (⌘⌫), which asks first, with "Also delete its short and renders" off by default. ⌘⌫ on a
// focused row asks too.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ClipPanel, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { MacColumns, MacMeter, MacPill } from '../../components/desktop/MacColumns';
import { DrawingVeil } from '../../components/DrawingVeil';
import { ProductionDeleteDialog, type ProductionToDelete } from '../../components/desktop/ProductionDeleteDialog';
import { LoadError } from '../../components/LoadError';
import { MAC_STUDIO_COPY, MUSE_IMAGE_COPY, PRODUCTION_COPY, PRODUCTION_STATUS_COPY } from '../../core/copy';
import { MUSE_COST } from '../../core/muse-image';
import {
  coverageLine,
  coveragePercent,
  createdLine,
  formatChip,
  hasStoryShort,
  STATUS_TONE,
  toFilmChip,
} from '../../core/production-view';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { Skeleton } from '../../design/Skeleton';
import { useMenu } from '../../hooks/useMenu';
import { useProductionArt, useProductions, useStoryShortLookup, type ProductionArtActions } from '../../hooks/useProductions';
import type { ProductionListItem } from '../../services/api/types';
import './MacProductionsPage.css';

const productionPath = (id: string) => `/productions/${encodeURIComponent(id)}`;

interface RowProps {
  item: ProductionListItem;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: (target: ProductionToDelete) => void;
}

function Row({ item, isSelected, onSelect, onDelete }: RowProps) {
  const menu = useMenu();
  const navigate = useNavigate();
  const findShort = useStoryShortLookup();
  const toFilm = toFilmChip(item.missing_titles);
  const askDelete = () => {
    onDelete({ productionId: item.production_id, title: item.title, status: item.status });
  };
  const items: MenuEntry[] = [
    {
      kind: 'item',
      label: MAC_STUDIO_COPY.open,
      hint: '⏎',
      onSelect: () => {
        void navigate(productionPath(item.production_id));
      },
    },
    {
      kind: 'item',
      label: MAC_STUDIO_COPY.openItsShort,
      isDisabled: !hasStoryShort(item.status),
      onSelect: () => {
        void findShort(item.production_id).then((shortId) => {
          if (shortId !== null) void navigate(`/editor/${encodeURIComponent(shortId)}`);
        });
      },
    },
    { kind: 'separator' },
    { kind: 'item', label: MAC_STUDIO_COPY.deleteProduction, hint: '⌘⌫', isDanger: true, onSelect: askDelete },
  ];
  const isOpen = menu.anchor !== null;
  const thumb = item.art_url ?? item.cover_url;
  return (
    <li
      className={isOpen || isSelected ? 'mac-productions__row mac-productions__row--on' : 'mac-productions__row'}
      onContextMenu={menu.openAtPointer}
    >
      <button
        type="button"
        className="mac-productions__open"
        aria-pressed={isSelected}
        onClick={onSelect}
        onDoubleClick={() => {
          void navigate(productionPath(item.production_id));
        }}
        onKeyDown={(event) => {
          if (event.metaKey && event.key === 'Backspace') {
            event.preventDefault();
            askDelete();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void navigate(productionPath(item.production_id));
          }
        }}
      >
        <span className="mac-productions__board">{thumb !== null && <img src={thumb} alt="" loading="lazy" />}</span>
        <span className="mac-productions__text">
          <span className="mac-productions__title-line">
            <span className="mac-productions__title">{item.title}</span>
            <MacPill isSmall>{formatChip(item.format, item.target_s)}</MacPill>
            <MacPill isSmall tone={STATUS_TONE[item.status]}>
              {PRODUCTION_STATUS_COPY[item.status]}
            </MacPill>
          </span>
          <span className="mac-productions__muted">{createdLine(item.created_at, item.status)}</span>
        </span>
        <span className="mac-productions__coverage">
          <span className="mac-productions__coverage-line">{coverageLine(item.covered_count, item.shot_count)}</span>
          <MacMeter percent={coveragePercent(item.covered_count, item.shot_count)} label={`${item.title}: shots covered`} />
        </span>
        <span className="mac-productions__to-film">{toFilm !== null && <MacPill tone="warning">{toFilm}</MacPill>}</span>
      </button>
      <button
        type="button"
        className="mac-button mac-button--icon"
        aria-label={MAC_STUDIO_COPY.productionOptions}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu anchor={menu.anchor} label={item.title} items={items} onClose={menu.close} className="mac-menu--narrow" />
    </li>
  );
}

/** The right column: the selected production's key art and what can be done with it. */
function Selected({ item, art }: { item: ProductionListItem; art: ProductionArtActions }) {
  const hasArt = item.art_url !== null;
  return (
    <ClipPanel>
      <div className="mac-productions__aside">
        <span className="mac-productions__art">
          {item.art_url !== null && <img src={item.art_url} alt="" />}
          {item.art_drawing && <DrawingVeil label={MUSE_IMAGE_COPY.drawingKeyArt} />}
        </span>
        <span className="mac-productions__note">{hasArt ? MUSE_IMAGE_COPY.productionArtNote : MUSE_IMAGE_COPY.productionArtPending}</span>
        <h2 className="mac-productions__aside-title">{item.title}</h2>
        <p className="mac-productions__aside-sub">{`${formatChip(item.format, item.target_s)} · ${coverageLine(item.covered_count, item.shot_count)}`}</p>
        <div className="mac-productions__aside-buttons">
          <button
            type="button"
            className="mac-button clip-panel__grow"
            disabled={item.art_drawing || item.status === 'planning'}
            onClick={() => {
              void art.newArt(item.production_id);
            }}
          >
            {MUSE_COST.newArt}
          </button>
          <button
            type="button"
            className="mac-button clip-panel__grow"
            disabled={!hasArt || item.art_drawing || !hasStoryShort(item.status)}
            onClick={() => {
              void art.useAsCover(item.production_id);
            }}
          >
            {MUSE_IMAGE_COPY.useAsCover}
          </button>
        </div>
      </div>
      <ClipPanelFooter>
        <Link to={productionPath(item.production_id)} className="mac-button mac-button--primary">
          {MUSE_IMAGE_COPY.openProduction}
        </Link>
      </ClipPanelFooter>
    </ClipPanel>
  );
}

/**
 * The page (`/productions` in the Mac app).
 * @returns The page.
 */
export function MacProductionsPage() {
  const { state, refresh } = useProductions();
  const [deleting, setDeleting] = useState<ProductionToDelete | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const art = useProductionArt(refresh);
  const rows = state.status === 'ready' ? [...state.data].sort((a, b) => b.created_at.localeCompare(a.created_at)) : [];
  const selected = rows.find((row) => row.production_id === selectedId) ?? rows[0];
  const newProduction = (
    <Link to="/productions/new" className="mac-button mac-button--new">
      <Icon name="plus" size="xs" />
      {PRODUCTION_COPY.newProduction}
    </Link>
  );
  return (
    <MacColumns asideLabel="Selected production" aside={selected === undefined ? undefined : <Selected item={selected} art={art} />}>
      <header className="mac-columns__head">
        <h1 className="mac-columns__title">{PRODUCTION_COPY.productions}</h1>
        <span className="mac-columns__sub">{PRODUCTION_COPY.macSubtitle}</span>
        <span className="mac-columns__grow" />
        {newProduction}
      </header>
      {state.status === 'loading' && (
        <div className="mac-productions__list" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading productions…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="productions" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && (
        <EmptyState icon="sparkle" title={PRODUCTION_COPY.emptyTitle} body={PRODUCTION_COPY.emptyBody} action={newProduction} />
      )}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="mac-productions__list">
          {rows.map((item) => (
            <Row
              key={item.production_id}
              item={item}
              isSelected={item.production_id === selected?.production_id}
              onSelect={() => {
                setSelectedId(item.production_id);
              }}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}
      <ProductionDeleteDialog
        target={deleting}
        onCancel={() => {
          setDeleting(null);
        }}
        onDeleted={() => {
          setDeleting(null);
          refresh();
        }}
      />
    </MacColumns>
  );
}
