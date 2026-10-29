// On this Mac (Mac app only, mock M3; the route stays /sync): where the library is in Finder, one
// big number for the space nimbytes uses on this Mac with a bar against the cache limit, the clips
// kept offline, and "How it stays at zero": before you play, while you watch (with each playing
// clip's countdown), and the release a few minutes later, lit live from `sync_status` and every
// `sync://status` push. "Can't reach <server>" with Try again shows above it when offline.
import { useState, type ReactNode } from 'react';
import { AvailabilityIcon } from '../components/desktop/AvailabilityIcon';
import { LoadError } from '../components/LoadError';
import { macDriveLine } from '../core/copy';
import { displayFolder, spaceUsedLabel, syncProblem, type SyncStatus } from '../core/desktop-sync';
import { formatDuration } from '../core/format';
import { nextStripPhase, onThisMacView, type OnThisMacView, type StripPhase } from '../core/on-this-mac';
import { formatGb } from '../core/storage';
import { Button, buttonClassName } from '../design/Button';
import { Skeleton } from '../design/Skeleton';
import { useClips } from '../hooks/useClips';
import { useServerUrl, useSyncActions, useSyncStatus } from '../hooks/useDesktop';
import { useNow } from '../hooks/useNow';
import { useStorage } from '../hooks/useOverview';
import type { ClipSummary } from '../services/api/types';
import './OnThisMacPage.css';

/** How often the countdowns redraw. */
const TICK_MS = 1000;

type Titles = ReadonlyMap<string, ClipSummary>;

function SpaceCard({ view }: { view: OnThisMacView }) {
  const storage = useStorage();
  const library = storage.status === 'ready' ? `of ${formatGb(storage.data.cloud_bytes)} in your library` : '';
  const isNothing = view.stateLines.length === 1 && view.kept.length === 0 && !view.isPlaying;
  return (
    <section className="on-mac__card" aria-labelledby="on-mac-space">
      <span className="on-mac__label" id="on-mac-space">
        Space used on this Mac
      </span>
      <div className="on-mac__number-row">
        <span className="on-mac__number" role="status">
          {view.spaceUsed}
        </span>
        <span className="on-mac__muted">{library}</span>
      </div>
      <div className="on-mac__bar" aria-hidden="true">
        <span className="on-mac__bar-kept" style={{ width: `${String(view.keptPercent)}%` }} />
        <span className="on-mac__bar-playing" style={{ width: `${String(view.playingPercent)}%` }} />
      </div>
      <div className="on-mac__bar-foot">
        <span className="on-mac__muted">{view.capLine}</span>
        <span className={isNothing ? 'on-mac__state on-mac__state--empty' : 'on-mac__state'}>{view.stateLines.join(' · ')}</span>
      </div>
    </section>
  );
}

function ClipRow({ clip, clipId, line, state }: { clip: ClipSummary | undefined; clipId: string; line: string; state: 'kept' | 'cached' }) {
  return (
    <li className="on-mac__row">
      <span className="on-mac__thumb">{clip?.thumb_url != null && <img src={clip.thumb_url} alt="" />}</span>
      <span className="on-mac__row-text">
        <span className="on-mac__row-title">{clip?.title ?? clipId}</span>
        <span className="on-mac__muted">{line}</span>
      </span>
      <AvailabilityIcon state={state} />
    </li>
  );
}

function KeptCard({ view, titles }: { view: OnThisMacView; titles: Titles }) {
  return (
    <section className="on-mac__card on-mac__card--kept" aria-labelledby="on-mac-kept">
      <span className="on-mac__label" id="on-mac-kept">
        Kept offline
      </span>
      <span className="on-mac__muted">
        Clips you choose to keep stay on this Mac and are never freed on their own. They count toward the number on the left.
      </span>
      {view.kept.length === 0 ? (
        <div className="on-mac__row on-mac__row--empty">
          <AvailabilityIcon state="kept" size="lg" />
          <span className="on-mac__row-text">
            <span className="on-mac__row-title">Nothing kept offline</span>
            <span className="on-mac__muted">Right-click a clip › Make available offline</span>
          </span>
        </div>
      ) : (
        <ul className="on-mac__list">
          {view.kept.map((kept) => (
            <ClipRow key={kept.clipId} clip={titles.get(kept.clipId)} clipId={kept.clipId} line={kept.bytes > 0 ? spaceUsedLabel(kept.bytes) : 'Downloading…'} state="kept" />
          ))}
        </ul>
      )}
    </section>
  );
}

interface StepProps {
  isLit: boolean;
  icon: 'cloud' | 'cached';
  title: string;
  number: string;
  children: ReactNode;
}

function Step({ isLit, icon, title, number, children }: StepProps) {
  return (
    <li className={isLit ? 'on-mac__step on-mac__step--lit' : 'on-mac__step'} aria-current={isLit ? 'step' : undefined}>
      <span className="on-mac__step-head">
        <AvailabilityIcon state={icon} />
        <b>{title}</b>
      </span>
      <span className="on-mac__step-number">{number}</span>
      {children}
    </li>
  );
}

function Strip({ view, phase, titles }: { view: OnThisMacView; phase: StripPhase; titles: Titles }) {
  const minutes = `${String(view.releaseMinutes)} ${view.releaseMinutes === 1 ? 'minute' : 'minutes'}`;
  return (
    <section className="on-mac__how" aria-labelledby="on-mac-how">
      <h2 className="on-mac__section" id="on-mac-how">
        How it stays at zero
      </h2>
      <ol className="on-mac__strip">
        <Step isLit={phase === 'before'} icon="cloud" title="Before you play" number="0 bytes">
          <span className="on-mac__muted">
            Every clip and short is listed in Finder at full size. Finder previews pass through without saving anything.
          </span>
        </Step>
        <Step isLit={phase === 'during'} icon="cached" title="While you watch" number="A few MB">
          <span className="on-mac__muted">Only the parts you play come down, in 1 MB pieces. Works in Finder, QuickTime and your editor.</span>
          {view.playing.length > 0 && (
            <ul className="on-mac__list">
              {view.playing.map((clip) => (
                <ClipRow
                  key={clip.clipId}
                  clip={titles.get(clip.clipId)}
                  clipId={clip.clipId}
                  line={`${spaceUsedLabel(clip.bytes)}${clip.freesInS === null ? '' : ` · frees in ${formatDuration(clip.freesInS)}`}`}
                  state="cached"
                />
              ))}
            </ul>
          )}
        </Step>
        <Step isLit={phase === 'after'} icon="cloud" title={`${minutes} later`} number="0 bytes">
          <span className="on-mac__muted">
            {`Anything not read for ${minutes} is freed on its own. Footage used in shorts goes last when space is tight.`}
          </span>
        </Step>
      </ol>
    </section>
  );
}

/** The live part: the view at this second and the strip's lit step, which remembers a release. */
function Live({ status, titles }: { status: SyncStatus; titles: Titles }) {
  const now = useNow(TICK_MS);
  const view = onThisMacView(status, now);
  const [phase, setPhase] = useState<StripPhase>(view.isPlaying ? 'during' : 'before');
  const [wasPlaying, setWasPlaying] = useState(view.isPlaying);
  if (wasPlaying !== view.isPlaying) {
    setWasPlaying(view.isPlaying);
    setPhase(nextStripPhase(phase, view.isPlaying));
  }
  return (
    <>
      <div className="on-mac__cards">
        <SpaceCard view={view} />
        <KeptCard view={view} titles={titles} />
      </div>
      <Strip view={view} phase={phase} titles={titles} />
    </>
  );
}

function useTitles(): Titles {
  const { state } = useClips();
  const clips = state.status === 'ready' ? state.data : [];
  return new Map(clips.map((clip) => [clip.clip_id, clip]));
}

/**
 * The On this Mac page.
 * @returns The page.
 */
export function OnThisMacPage() {
  const { state, reload } = useSyncStatus();
  const actions = useSyncActions();
  const server = useServerUrl();
  const titles = useTitles();
  const status = state.status === 'ready' ? state.data : null;
  const folder = displayFolder(status?.folder ?? '~/nimbytes');
  const drive = macDriveLine(folder);
  const problem = status === null ? null : syncProblem(status.state, server ?? null, status.error);
  return (
    <div className="on-mac">
      <header className="on-mac__head">
        <div className="on-mac__head-text">
          <h1 className="on-mac__title">On this Mac</h1>
          <p className="on-mac__muted on-mac__lead">
            {drive.before}
            <span className="on-mac__path">{drive.folder}</span>
            {drive.after}
          </p>
        </div>
        <button type="button" className={`${buttonClassName('primary')} on-mac__finder`} onClick={actions.revealFolder}>
          Show in Finder
        </button>
      </header>
      {problem !== null && (
        <div className="on-mac__problem" role="alert">
          <span className="on-mac__problem-text">{problem}</span>
          <Button variant="secondary" onClick={actions.syncNow}>
            Try again
          </Button>
        </div>
      )}
      {state.status === 'loading' && (
        <div aria-busy="true" className="on-mac__card">
          <p className="visually-hidden" role="status">
            Loading what is on this Mac…
          </p>
          <Skeleton kind="title" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="what is on this Mac" onRetry={reload} />}
      {status !== null && <Live status={status} titles={titles} />}
      <p className="on-mac__exports">
        <span className="on-mac__dot" aria-hidden="true" />
        <span>
          Edits you save into <span className="on-mac__path">{`${folder}/Exports`}</span> upload to your library on their own.
        </span>
      </p>
    </div>
  );
}
