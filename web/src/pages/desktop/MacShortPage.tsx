// A short on the Mac (redesign v2, V7): "‹ Shorts / name", the quoted prompt, aspect and length,
// the draft picker and ⋯ (Adjust cut, Export 1080p, Finish for a story short, Delete short…); the
// 380 px player with its compact controls beside "In the timeline" (one row per shot: start, thumb,
// name, the editor's reason, Proxy or Original; a click selects the shot and seeks to it) and "Why
// this cut"; a story short's acts strip; and on the right the draft and editor score, the post
// caption and hashtags, Finish on your Mac, then Share (or Export 1080p before a render), Download
// and Publish…. While the editor works, its live steps show under the header.
import type { PlayerRef } from '@remotion/player';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ActsStrip } from '../../components/ActsStrip';
import { ClipPanel, ClipPanelButtons, ClipPanelFooter } from '../../components/desktop/ClipPanel';
import { MacColumns, MacCrumb, MacPill } from '../../components/desktop/MacColumns';
import { MacConfirmDialog } from '../../components/desktop/MacConfirmDialog';
import { MacShortPlayer } from '../../components/desktop/MacShortPlayer';
import { ShortFinish } from '../../components/desktop/ShortFinish';
import { LoadError } from '../../components/LoadError';
import { ShortWorking } from '../../components/ShortWorking';
import { TimelineEditor } from '../../components/TimelineEditor';
import { isShortWorking, pickBestVersion, SCORE_MAX, shortName, shortStatusLabel } from '../../core/agent-trail';
import { STUDIO_COPY } from '../../core/copy';
import { SHORT_DELETE_COPY } from '../../core/delete-copy';
import { formatDuration } from '../../core/format';
import { shotNames } from '../../core/humanize';
import { nleShots } from '../../core/nle-shots';
import { timelineLength } from '../../core/timeline-edit';
import { EmptyState } from '../../design/EmptyState';
import { Icon } from '../../design/Icon';
import { Menu, type MenuEntry } from '../../design/Menu';
import { Sheet } from '../../design/Sheet';
import { Skeleton } from '../../design/Skeleton';
import { useDeleteShort } from '../../hooks/useDelete';
import { useOriginalsOnDisk } from '../../hooks/useDesktop';
import { useFinalRender, useShareVideo, useShort, type FinalRender } from '../../hooks/useEditor';
import { useMenu } from '../../hooks/useMenu';
import { usePlayableProps } from '../../hooks/usePlayableProps';
import { usePlayerProps } from '../../hooks/usePlayerProps';
import { useShortProduction } from '../../hooks/useProduction';
import { useTimelineDraft } from '../../hooks/useTimelineDraft';
import type { AgentStep, ShortDetail, ShortProduction, ShortVersion } from '../../services/api/types';
import './MacShortPage.css';

const SHORTS = '/shorts';
const ASIDE_LABEL = 'Finish and share';

interface HeaderProps {
  detail: ShortDetail | null;
  shown: ShortVersion | undefined;
  lengthS: number | null;
  onPick: (n: number) => void;
  actions: MenuEntry[];
}

function DraftPicker({ detail, shown, onPick }: { detail: ShortDetail; shown: ShortVersion; onPick: (n: number) => void }) {
  const menu = useMenu();
  return (
    <>
      <button type="button" className="mac-button mac-button--head" aria-haspopup="menu" aria-expanded={menu.anchor !== null} onClick={menu.openFromButton}>
        {`Draft ${String(shown.n)}`}
        <Icon name="chevron-down" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label="Drafts"
        onClose={menu.close}
        className="mac-menu--narrow"
        items={[...detail.versions]
          .sort((a, b) => a.n - b.n)
          .map((version) => ({
            kind: 'check',
            label: `Draft ${String(version.n)}`,
            isChecked: version.n === shown.n,
            onSelect: () => {
              onPick(version.n);
            },
          }))}
      />
    </>
  );
}

/** The header's ⋯: the page's own actions, then Delete short… behind the confirm. */
function Options({ shortId, actions }: { shortId: string; actions: MenuEntry[] }) {
  const menu = useMenu();
  const navigate = useNavigate();
  const deletion = useDeleteShort();
  const [isConfirming, setConfirming] = useState(false);
  return (
    <>
      <button
        type="button"
        className="mac-button mac-button--head mac-button--icon"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={menu.anchor !== null}
        onClick={menu.openFromButton}
      >
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label="Short actions"
        onClose={menu.close}
        className="mac-menu--narrow"
        items={[
          ...actions,
          ...(actions.length > 0 ? [{ kind: 'separator' } as const] : []),
          {
            kind: 'item',
            label: 'Delete short…',
            isDanger: true,
            onSelect: () => {
              setConfirming(true);
            },
          },
        ]}
      />
      <MacConfirmDialog
        open={isConfirming}
        copy={SHORT_DELETE_COPY}
        isBusy={deletion.isDeleting}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          void deletion.remove(shortId).then((isDone) => {
            if (isDone) void navigate(SHORTS, { replace: true });
          });
        }}
      />
    </>
  );
}

function Header({ detail, shown, lengthS, onPick, actions }: HeaderProps) {
  const short = detail?.short;
  const meta =
    short === undefined ? null : [`“${short.prompt}”`, short.aspect, ...(lengthS === null ? [] : [formatDuration(lengthS)])].join(' · ');
  return (
    <header className="mac-columns__head mac-columns__head--crumb">
      <MacCrumb to={SHORTS} label={STUDIO_COPY.shorts} />
      <h1 className="mac-columns__crumb-title">{detail === null ? '' : shortName(shown)}</h1>
      {meta !== null && <span className="mac-columns__sub">{meta}</span>}
      <span className="mac-columns__grow" />
      {detail !== null && shown !== undefined && <DraftPicker detail={detail} shown={shown} onPick={onPick} />}
      {short !== undefined && <Options shortId={short.short_id} actions={actions} />}
    </header>
  );
}

/** Share (Export 1080p before a render), Download and Publish…. */
function Footer({ detail, shown, final }: { detail: ShortDetail; shown: ShortVersion; final: FinalRender }) {
  const navigate = useNavigate();
  const share = useShareVideo();
  const short = detail.short;
  const isWorking = isShortWorking(short.status);
  const url = short.render_url;
  const filename = `nimbytes-${short.short_id}.mp4`;
  const isRendering = url === null && short.status !== 'failed' && final.isPending;
  return (
    <ClipPanelFooter>
      {url !== null ? (
        <button
          type="button"
          className="mac-button mac-button--primary"
          disabled={share.state === 'sharing'}
          onClick={() => {
            void share.share(url, filename, shown.timeline.post.caption);
          }}
        >
          {share.state === 'sharing' ? 'Preparing…' : share.state === 'unsupported' ? 'Use Download' : 'Share'}
        </button>
      ) : (
        <button
          type="button"
          className="mac-button mac-button--primary"
          disabled={isWorking || isRendering}
          onClick={() => {
            void final.render(shown.n);
          }}
        >
          {isRendering ? 'Exporting…' : 'Export 1080p'}
        </button>
      )}
      <ClipPanelButtons>
        {url !== null ? (
          <a className="mac-button clip-panel__grow" href={url} download={filename}>
            Download
          </a>
        ) : (
          <button type="button" className="mac-button clip-panel__grow" disabled>
            Download
          </button>
        )}
        <button
          type="button"
          className="mac-button clip-panel__grow"
          disabled={isWorking}
          onClick={() => {
            void navigate(`/editor/${encodeURIComponent(short.short_id)}/publish`);
          }}
        >
          Publish…
        </button>
      </ClipPanelButtons>
    </ClipPanelFooter>
  );
}

function Aside({ detail, shown, final }: { detail: ShortDetail; shown: ShortVersion; final: FinalRender }) {
  const post = shown.timeline.post;
  return (
    <ClipPanel>
      <div className="mac-short__aside">
        <div className="mac-short__score">
          <span>{`Draft ${String(shown.n)}`}</span>
          <span>
            Editor score{' '}
            <span className="mac-short__score-number">{`${shown.score_total === null ? '–' : String(shown.score_total)} / ${String(SCORE_MAX)}`}</span>
          </span>
        </div>
        <div className="mac-short__post">
          <span className="mac-columns__label">Post</span>
          <p className="mac-short__caption">{post.caption}</p>
          {post.hashtags.length > 0 && <p className="mac-short__tags">{post.hashtags.join(' ')}</p>}
        </div>
        <ShortFinish shortId={detail.short.short_id} hasRender={detail.short.render_url !== null} />
      </div>
      <Footer detail={detail} shown={shown} final={final} />
    </ClipPanel>
  );
}

interface DraftProps {
  detail: ShortDetail;
  shown: ShortVersion;
  steps: AgentStep[];
  production: ShortProduction | null;
  final: FinalRender;
  refresh: () => void;
  onPick: (n: number) => void;
}

function Draft({ detail, shown, steps, production, final, refresh, onPick }: DraftProps) {
  const navigate = useNavigate();
  const draft = useTimelineDraft(detail.short.short_id, shown, detail.segments);
  // The Player follows the draft; on the Mac its shots read synced proxies from disk when they can.
  const cloudProps = usePlayerProps(shown.composition_props, draft.clips);
  const playerProps = usePlayableProps(cloudProps, detail.segments);
  const playerRef = useRef<PlayerRef>(null);
  const [picked, setPicked] = useState(0);
  const [isAdjusting, setAdjusting] = useState(false);
  const previous = detail.versions.find((v) => v.n === shown.timeline.revision?.from_version) ?? null;
  const names = useMemo(
    () => shotNames([shown.timeline.clips, previous?.timeline.clips ?? []], detail.segments),
    [shown, previous, detail.segments],
  );
  const rows = useMemo(() => nleShots(shown.timeline.clips, detail.segments, names), [shown, detail.segments, names]);
  const clipIds = useMemo(() => [...new Set(rows.map((row) => row.clipId).filter((id): id is string => id !== null))], [rows]);
  const originals = useOriginalsOnDisk(clipIds);
  const working = isShortWorking(detail.short.status);
  const lengthS = timelineLength(draft.clips);
  const shortId = detail.short.short_id;
  const actions: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Adjust cut…',
      isDisabled: working,
      onSelect: () => {
        setAdjusting(true);
      },
    },
    ...(detail.short.render_url === null
      ? [
          {
            kind: 'item' as const,
            label: 'Export 1080p',
            isDisabled: working || final.isPending,
            onSelect: () => {
              void final.render(shown.n);
            },
          },
        ]
      : []),
    ...(production === null
      ? []
      : [
          {
            kind: 'item' as const,
            label: 'Finish…',
            isDisabled: working,
            onSelect: () => {
              void navigate(`/editor/${encodeURIComponent(shortId)}/finish`);
            },
          },
        ]),
  ];
  return (
    <MacColumns asideLabel={ASIDE_LABEL} aside={<Aside detail={detail} shown={shown} final={final} />}>
      <Header detail={detail} shown={shown} lengthS={lengthS} onPick={onPick} actions={actions} />
      {working && (
        <div className="mac-short__working">
          <ShortWorking steps={steps} label={shortStatusLabel(detail.short.status)} />
        </div>
      )}
      <div className="mac-short__body">
        <MacShortPlayer
          version={shown}
          playerProps={playerProps}
          lengthS={lengthS}
          isWorking={working}
          starts={rows.map((row) => row.startS)}
          playerRef={playerRef}
          {...(playerProps !== null && playerProps !== cloudProps ? { badgeSuffix: 'from disk' } : {})}
        />
        <section className="mac-short__timeline" aria-label="In the timeline">
          <div className="mac-short__timeline-head">
            <h2 className="mac-short__timeline-title">In the timeline</h2>
            <span className="mac-short__muted-sm">{`${String(rows.length)} ${rows.length === 1 ? 'shot' : 'shots'} · each marker holds the AI’s reason`}</span>
          </div>
          {rows.map((row, index) => {
            const isOriginal = row.clipId !== null && originals.get(row.clipId) === true;
            return (
              <button
                key={row.key}
                type="button"
                className={index === picked ? 'mac-short__shot mac-short__shot--on' : 'mac-short__shot'}
                aria-pressed={index === picked}
                onClick={() => {
                  setPicked(index);
                  if (playerProps !== null) playerRef.current?.seekTo(Math.round(row.startS * playerProps.fps));
                }}
              >
                <span className="mac-short__at">{row.at}</span>
                <span className="mac-short__thumb">{row.thumbUrl !== null && <img src={row.thumbUrl} alt="" loading="lazy" />}</span>
                <span className="mac-short__shot-text">
                  <span className="mac-short__shot-name">{row.name}</span>
                  <span className="mac-short__reason">{row.reason}</span>
                </span>
                <MacPill tone={isOriginal ? 'accent' : 'neutral'}>{isOriginal ? 'Original' : 'Proxy'}</MacPill>
              </button>
            );
          })}
          {shown.timeline.rationale.trim() !== '' && <p className="mac-short__why">{`Why this cut: ${shown.timeline.rationale}`}</p>}
        </section>
      </div>
      {production !== null && (
        <div className="mac-short__acts">
          <ActsStrip clips={draft.clips} shots={production.shots} />
        </div>
      )}
      <Sheet
        open={isAdjusting}
        onClose={() => {
          setAdjusting(false);
        }}
        title={`Adjust draft ${String(shown.n)}`}
      >
        <TimelineEditor
          draft={draft}
          segments={detail.segments}
          previous={previous?.timeline.clips ?? null}
          targetSeconds={shown.timeline.target_seconds}
          onSaved={(n) => {
            setAdjusting(false);
            refresh();
            onPick(n);
          }}
        />
      </Sheet>
    </MacColumns>
  );
}

/**
 * The page (`/editor/:id` in the Mac app).
 * @returns The page.
 */
export function MacShortPage() {
  const { id = '' } = useParams();
  const { state, steps, refresh } = useShort(id);
  const productionState = useShortProduction(id);
  const production = productionState.status === 'ready' ? productionState.production : null;
  const final = useFinalRender(id, refresh);
  const [selected, setSelected] = useState<number | null>(null);

  if (state.status !== 'ready') {
    return (
      <MacColumns asideLabel={ASIDE_LABEL} aside={null}>
        <Header detail={null} shown={undefined} lengthS={null} onPick={setSelected} actions={[]} />
        <div className="mac-short__body">
          {state.status === 'loading' ? (
            <div className="mac-short__loading" aria-busy="true">
              <p className="visually-hidden" role="status">
                Loading the short…
              </p>
              <Skeleton kind="video" />
            </div>
          ) : (
            <LoadError error={state.error} thing="short" onRetry={refresh} />
          )}
        </div>
      </MacColumns>
    );
  }

  const detail = state.data;
  const best = pickBestVersion(detail.versions, detail.short.best_version);
  const shownN = selected !== null && detail.versions.some((v) => v.n === selected) ? selected : best;
  const shown = detail.versions.find((v) => v.n === shownN);
  if (shown !== undefined) {
    return (
      <Draft key={shown.n} detail={detail} shown={shown} steps={steps} production={production} final={final} refresh={refresh} onPick={setSelected} />
    );
  }
  const working = isShortWorking(detail.short.status);
  return (
    <MacColumns asideLabel={ASIDE_LABEL} aside={null}>
      <Header detail={detail} shown={undefined} lengthS={null} onPick={setSelected} actions={[]} />
      {working && (
        <div className="mac-short__working">
          <ShortWorking steps={steps} label={shortStatusLabel(detail.short.status)} />
        </div>
      )}
      {detail.short.status === 'failed' && (
        <EmptyState icon="shorts" title="The editor stopped" body="No draft was finished. Try again with other moments." />
      )}
    </MacColumns>
  );
}
