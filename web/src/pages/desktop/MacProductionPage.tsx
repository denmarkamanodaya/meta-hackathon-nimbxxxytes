// A production on the Mac (redesign v2, V8): "‹ Productions / title", its format, aspect and
// status, the coverage ("5 / 6 shots covered" over a slim bar), Check again and ⋯ (Open its short,
// Delete production…); the shots by act as compact rows (storyboard with its number, title and
// direction, length, Covered or Missing, and the matched moment or what to film); and on the right
// the selected shot: its storyboard, what it is, the moment that covers it (Play moment, Other
// takes) or the tips to film it. The footer cuts the story (or opens it) and uploads what is
// missing. While the planner runs, its live progress shows; a stopped plan shows why and Retry.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ClipPanel, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { MacColumns, MacCrumb, MacMeter, MacPill } from '../../components/desktop/MacColumns';
import { ProductionDeleteDialog, type ProductionToDelete } from '../../components/desktop/ProductionDeleteDialog';
import { LoadError } from '../../components/LoadError';
import { PlanProgress, PlanStopped } from '../../components/ProductionRun';
import { MAC_STUDIO_COPY, PRODUCTION_COPY } from '../../core/copy';
import { libraryQueryPath } from '../../core/library-query';
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
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
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
function Board({ shot, className }: { shot: ProductionShot; className: string }) {
  return (
    <span className={className}>
      {shot.board_url === null ? (
        <span className="mac-production__drawing">
          <Spinner />
          <span className="visually-hidden">Drawing the storyboard</span>
        </span>
      ) : (
        <img src={shot.board_url} alt="" loading="lazy" />
      )}
    </span>
  );
}

interface ShotRowProps {
  shot: ProductionShot;
  isPlanning: boolean;
  isSelected: boolean;
  onSelect: () => void;
}

function ShotRow({ shot, isPlanning, isSelected, onSelect }: ShotRowProps) {
  const match = shot.match;
  return (
    <button
      type="button"
      className={isSelected ? 'mac-production__shot mac-production__shot--on' : 'mac-production__shot'}
      aria-pressed={isSelected}
      onClick={onSelect}
    >
      <span className="mac-production__board-sm">
        <Board shot={shot} className="mac-production__board-img" />
        <span className="mac-production__number" aria-hidden="true">
          {shot.ord}
        </span>
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
    </button>
  );
}

function SelectedShot({ shot, aspect, isPlanning }: { shot: ProductionShot; aspect: string; isPlanning: boolean }) {
  const navigate = useNavigate();
  const match = shot.match;
  return (
    <div className="mac-production__selected">
      <Board shot={shot} className={`mac-production__board-lg mac-production__board-lg--${aspect === '1:1' ? 'square' : 'portrait'}`} />
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
              onClick={() => {
                void navigate(libraryQueryPath(shot.direction));
              }}
            >
              {`Other takes (${String(shot.take_count)})`}
            </button>
          </div>
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

/** The header's ⋯: Open its short and Delete production…. */
function Options({ detail }: { detail: ProductionDetail }) {
  const menu = useMenu();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState<ProductionToDelete | null>(null);
  const p = detail.production;
  const shortId = p.short_id;
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label={`${MAC_STUDIO_COPY.productionOptions}: ${MAC_STUDIO_COPY.openItsShort}, Delete production`}
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
          <Options detail={detail} />
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
  return (
    <MacColumns
      asideLabel="Selected shot"
      aside={
        <ClipPanel>
          {selected === undefined ? <span className="mac-production__selected" /> : <SelectedShot shot={selected} aspect={p.aspect} isPlanning={isPlanning} />}
          <Footer detail={detail} handle={handle} />
        </ClipPanel>
      }
    >
      <Header detail={detail} handle={handle} />
      <p className="mac-production__note">{PRODUCTION_COPY.coverageNote}</p>
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
