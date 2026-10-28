// A production on the Mac (redesign v2, V8 and V15): "‹ Productions / title", its format, aspect
// and status, the coverage ("5 / 6 shots covered" over a slim bar), Check again and ⋯ (Open its
// short, Delete production…); the shots by act as compact rows (storyboard with its number and,
// once redrawn from the real frame, the footage badge; title and direction, length, Covered or
// Missing, and the matched moment or what to film); and on the right the selected shot: Planned /
// From your footage, its storyboard and where it came from, what it is, the moment that covers it
// (Play moment, Redraw from footage and its cost) or the tips to film it. The footer cuts the
// story (or opens it) and uploads what is missing. While the planner runs, its live progress
// shows; a stopped plan shows why and Retry. ⋯ also holds Rename production….
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ClipPanel, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { DrawingVeil } from '../../components/DrawingVeil';
import { MacColumns, MacCrumb, MacMeter, MacPill } from '../../components/desktop/MacColumns';
import { ProductionDeleteDialog, type ProductionToDelete } from '../../components/desktop/ProductionDeleteDialog';
import { RenameProductionSheet, type ProductionToRename } from '../../components/desktop/RenameProductionSheet';
import { LoadError } from '../../components/LoadError';
import { PlanProgress, PlanStopped } from '../../components/ProductionRun';
import { MAC_STUDIO_COPY, MUSE_IMAGE_COPY, PRODUCTION_COPY } from '../../core/copy';
import { MUSE_COST } from '../../core/muse-image';
import {
  actLabel,
  coveragePercent,
  filmItHint,
  groupByAct,
  matchLine,
  productionMeta,
  shotHead,
  shotLength,
} from '../../core/production-view';
import {
  boardNote,
  boardShown,
  defaultBoardView,
  hasFootageBoard,
  isDrawingFootage,
  rowBoardUrl,
  type BoardView,
} from '../../core/storyboard';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { SegmentedTabs } from '../../design/SegmentedTabs';
import { Skeleton } from '../../design/Skeleton';
import { Spinner } from '../../design/Spinner';
import { usePickAndUpload } from '../../hooks/useDesktop';
import { useMenu } from '../../hooks/useMenu';
import { useProduction, type ProductionHandle } from '../../hooks/useProduction';
import type { ProductionDetail, ProductionShot } from '../../services/api/types';
import './MacProductionPage.css';

const PRODUCTIONS = '/productions';
const shortPath = (shortId: string) => `/editor/${encodeURIComponent(shortId)}`;

/** A storyboard frame, or a spinner while it is drawn. */
function Board({ url, className, children }: { url: string | null; className: string; children?: ReactNode }) {
  return (
    <span className={className}>
      {url === null ? (
        <span className="mac-production__drawing">
          <Spinner />
          <span className="visually-hidden">Drawing the storyboard</span>
        </span>
      ) : (
        <img src={url} alt="" loading="lazy" />
      )}
      {children}
    </span>
  );
}

interface ShotRowProps {
  shot: ProductionShot;
  isPlanning: boolean;
  isSelected: boolean;
  /** Its footage board is being drawn. */
  isDrawing: boolean;
  onSelect: () => void;
}

function ShotRow({ shot, isPlanning, isSelected, isDrawing, onSelect }: ShotRowProps) {
  const match = shot.match;
  const note = boardNote(shot, isDrawing);
  return (
    <button
      type="button"
      className={isSelected ? 'mac-production__shot mac-production__shot--on' : 'mac-production__shot'}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <span className="mac-production__board-sm">
        <Board url={rowBoardUrl(shot)} className="mac-production__board-img" />
        <span className="mac-production__number" aria-hidden="true">
          {shot.ord}
        </span>
        {hasFootageBoard(shot) && !isDrawing && (
          <span className="mac-production__footage" role="img" aria-label={MUSE_IMAGE_COPY.drawnFromFootage}>
            <Icon name="film" size="xs" />
          </span>
        )}
      </span>
      <span className="mac-production__text">
        <span className="mac-production__title">
          <span className="visually-hidden">{`Shot ${String(shot.ord)}: `}</span>
          {shot.title}
        </span>
        <span className="mac-production__direction">{shot.direction}</span>
      </span>
      <span className="mac-production__len">{shotLength(shot.duration_s)}</span>
      {!isPlanning && (
        <MacPill tone={match === null ? 'warning' : 'success'}>{match === null ? PRODUCTION_COPY.missing : PRODUCTION_COPY.covered}</MacPill>
      )}
      <span className="mac-production__match">
        {isPlanning ? null : match === null ? (
          <span className="mac-production__film-it">{`Film it: ${filmItHint(shot)}`}</span>
        ) : (
          <>
            <span className="mac-production__moment-thumb">
              <img src={match.thumb_url} alt="" loading="lazy" />
            </span>
            <span className="mac-production__mono">{matchLine(match, shot.take_count)}</span>
          </>
        )}
      </span>
      {!isPlanning && <span className={`mac-production__board-note${note === null ? '' : ` mac-production__board-note--${note.tone}`}`}>{note?.text}</span>}
    </button>
  );
}

const BOARD_VIEWS = [
  { value: 'planned', label: MUSE_IMAGE_COPY.planned },
  { value: 'footage', label: MUSE_IMAGE_COPY.fromFootage },
] as const;

interface SelectedShotProps {
  shot: ProductionShot;
  aspect: string;
  isPlanning: boolean;
  isDrawing: boolean;
  onRedraw: () => void;
}

/** The selected shot; keyed by shot so its view starts on the shot's own default. */
function SelectedShot({ shot, aspect, isPlanning, isDrawing, onRedraw }: SelectedShotProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<BoardView>(defaultBoardView(shot));
  const match = shot.match;
  const board = boardShown(shot, view);
  return (
    <div className="mac-production__selected">
      {match !== null && (
        <span className="mac-production__views">
          <SegmentedTabs label={MUSE_IMAGE_COPY.storyboard} options={BOARD_VIEWS} value={view} onChange={setView} />
        </span>
      )}
      <Board url={board.url} className={`mac-production__board-lg mac-production__board-lg--${aspect === '1:1' ? 'square' : 'portrait'}`}>
        {isDrawing && board.isFootage && <DrawingVeil label={MUSE_IMAGE_COPY.drawingFromFootage} />}
      </Board>
      {!isPlanning && <span className="mac-production__caption">{board.caption}</span>}
      <span className="mac-production__head">{shotHead(shot)}</span>
      <h2 className="mac-production__selected-title">{shot.title}</h2>
      <p className="mac-production__selected-direction">{shot.direction}</p>
      {match !== null && (
        <div className="mac-production__section">
          <span className="mac-columns__label">Covered by</span>
          <span className="mac-production__mono">{matchLine(match, shot.take_count)}</span>
          <p className="mac-production__moment">{match.description}</p>
          <div className="mac-production__moment-buttons">
            <button
              type="button"
              className="mac-button clip-panel__grow"
              onClick={() => {
                void navigate(`/clips/${encodeURIComponent(match.clip_id)}?t=${String(Math.floor(match.start_s))}`);
              }}
            >
              Play moment
            </button>
            <button
              type="button"
              className="mac-button clip-panel__grow"
              disabled={isDrawing}
              onClick={() => {
                setView('footage');
                onRedraw();
              }}
            >
              {MUSE_IMAGE_COPY.redrawFromFootage}
            </button>
          </div>
          <span className="mac-production__cost">{MUSE_COST.footageBoard}</span>
        </div>
      )}
      {match === null && !isPlanning && (
        <div className="mac-production__section">
          <span className="mac-columns__label mac-production__warning">Not filmed yet · tips</span>
          {shot.tips.map((tip) => (
            <span key={tip} className="mac-production__tip">{`• ${tip}`}</span>
          ))}
          <span className="mac-production__upload-note">Upload it and the shot turns covered.</span>
        </div>
      )}
    </div>
  );
}

function Footer({ detail, handle }: { detail: ProductionDetail; handle: ProductionHandle }) {
  const navigate = useNavigate();
  const upload = usePickAndUpload();
  const p = detail.production;
  const isPlanning = p.status === 'planning';
  const missing = isPlanning ? 0 : detail.shots.length - detail.covered_count;
  return (
    <ClipPanelFooter>
      {p.short_id === null ? (
        <button
          type="button"
          className="mac-button mac-button--primary"
          disabled={!detail.can_cut || handle.isCutting || isPlanning}
          onClick={() => {
            void handle.cut().then((shortId) => {
              if (shortId !== null) void navigate(shortPath(shortId));
            });
          }}
        >
          {handle.isCutting && <Spinner />}
          {PRODUCTION_COPY.cutStory}
        </button>
      ) : (
        <Link to={shortPath(p.short_id)} className="mac-button mac-button--primary">
          {PRODUCTION_COPY.openStory}
        </Link>
      )}
      <button
        type="button"
        className="mac-button"
        disabled={missing === 0 || upload.isPicking}
        onClick={() => {
          void upload.pick();
        }}
      >
        {`${PRODUCTION_COPY.filmMissing} (${String(missing)})`}
      </button>
    </ClipPanelFooter>
  );
}

/** The header's ⋯: Open its short, Rename production… and Delete production…. */
function Options({ detail, onRenamed }: { detail: ProductionDetail; onRenamed: () => void }) {
  const menu = useMenu();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<ProductionToDelete | null>(null);
  const [renaming, setRenaming] = useState<ProductionToRename | null>(null);
  const p = detail.production;
  const shortId = p.short_id;
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${MAC_STUDIO_COPY.productionOptions}: ${MAC_STUDIO_COPY.openItsShort}, Rename production, Delete production`}
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label={MAC_STUDIO_COPY.productionOptions}
        onClose={menu.close}
        className="mac-menu--narrow"
        items={[
          {
            kind: 'item',
            label: MAC_STUDIO_COPY.openItsShort,
            isDisabled: shortId === null,
            onSelect: () => {
              if (shortId !== null) void navigate(shortPath(shortId));
            },
          },
          {
            kind: 'item',
            label: MAC_STUDIO_COPY.renameProduction,
            onSelect: () => {
              setRenaming({ productionId: p.production_id, title: p.title });
            },
          },
          { kind: 'separator' },
          {
            kind: 'item',
            label: MAC_STUDIO_COPY.deleteProduction,
            hint: '⌘⌫',
            isDanger: true,
            onSelect: () => {
              setDeleting({ productionId: p.production_id, title: p.title, status: p.status, shortId });
            },
          },
        ]}
      />
      <RenameProductionSheet
        target={renaming}
        onClose={() => {
          setRenaming(null);
        }}
        onRenamed={onRenamed}
      />
      <ProductionDeleteDialog
        target={deleting}
        onCancel={() => {
          setDeleting(null);
        }}
        onDeleted={() => {
          void navigate(PRODUCTIONS, { replace: true });
        }}
      />
    </>
  );
}

function Header({ detail, handle }: { detail: ProductionDetail | null; handle: ProductionHandle | null }) {
  const p = detail?.production;
  const total = detail?.shots.length ?? 0;
  const showCoverage = detail !== null && p !== undefined && p.status !== 'planning' && total > 0;
  return (
    <header className="mac-columns__head mac-columns__head--crumb">
      <MacCrumb to={PRODUCTIONS} label={PRODUCTION_COPY.productions} />
      <h1 className="mac-columns__crumb-title">{p?.title ?? ''}</h1>
      {p !== undefined && <span className="mac-columns__sub">{productionMeta(p)}</span>}
      <span className="mac-columns__grow" />
      {showCoverage && (
        <span className="mac-production__coverage">
          <span>
            <b>{`${String(detail.covered_count)} / ${String(total)}`}</b> <span className="mac-columns__sub">shots covered</span>
          </span>
          <span className="mac-production__coverage-bar">
            <MacMeter percent={coveragePercent(detail.covered_count, total)} label="Shots covered" />
          </span>
        </span>
      )}
      {detail !== null && handle !== null && (
        <>
          <button
            type="button"
            className="mac-button mac-button--head"
            disabled={detail.busy || p?.status === 'planning'}
            onClick={() => {
              void handle.recheck();
            }}
          >
            <Icon name="refresh" size="xs" />
            {MAC_STUDIO_COPY.checkAgain}
          </button>
          <Options detail={detail} onRenamed={handle.refresh} />
        </>
      )}
    </header>
  );
}

function Body({ detail, handle }: { detail: ProductionDetail; handle: ProductionHandle }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const p = detail.production;
  const isPlanning = p.status === 'planning';
  const selected = detail.shots.find((shot) => shot.shot_id === selectedId) ?? detail.shots.find((shot) => shot.ord === 1) ?? detail.shots[0];
  const drawing = (shot: ProductionShot) => isDrawingFootage(shot, detail.busy, handle.redrawingBoards.has(shot.shot_id));
  return (
    <MacColumns
      asideLabel="Selected shot"
      aside={
        <ClipPanel>
          {selected === undefined ? (
            <span className="mac-production__selected" />
          ) : (
            <SelectedShot
              key={selected.shot_id}
              shot={selected}
              aspect={p.aspect}
              isPlanning={isPlanning}
              isDrawing={drawing(selected)}
              onRedraw={() => {
                void handle.redrawBoard(selected.shot_id);
              }}
            />
          )}
          <Footer detail={detail} handle={handle} />
        </ClipPanel>
      }
    >
      <Header detail={detail} handle={handle} />
      <p className="mac-production__note">{MUSE_IMAGE_COPY.footageNote}</p>
      {(p.status === 'failed' || isPlanning || detail.busy) && (
        <div className="mac-production__run">
          {p.status === 'failed' && <PlanStopped error={p.error} onRetry={() => void handle.retry()} />}
          {(isPlanning || detail.busy) && <PlanProgress event={handle.progress} />}
        </div>
      )}
      <div className="mac-production__acts">
        {groupByAct(detail.shots).map((group) => (
          <section key={group.act} className="mac-production__act" aria-label={actLabel(group.act)}>
            <h2 className="mac-production__act-label">{actLabel(group.act)}</h2>
            {group.shots.map((shot) => (
              <ShotRow
                key={shot.shot_id}
                shot={shot}
                isPlanning={isPlanning}
                isSelected={shot.shot_id === selected?.shot_id}
                isDrawing={drawing(shot)}
                onSelect={() => {
                  setSelectedId(shot.shot_id);
                }}
              />
            ))}
          </section>
        ))}
      </div>
    </MacColumns>
  );
}

/**
 * The page (`/productions/:id` in the Mac app).
 * @returns The page.
 */
export function MacProductionPage() {
  const { id = '' } = useParams();
  const handle = useProduction(id);
  const { state, refresh } = handle;
  if (state.status === 'ready') return <Body key={id} detail={state.data} handle={handle} />;
  return (
    <MacColumns asideLabel="Selected shot" aside={null}>
      <Header detail={null} handle={null} />
      <div className="mac-production__run">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading the production…
            </p>
            <Skeleton kind="line" />
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="production" onRetry={refresh} />}
      </div>
    </MacColumns>
  );
}
