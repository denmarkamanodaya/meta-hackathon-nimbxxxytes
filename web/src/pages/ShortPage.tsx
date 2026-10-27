// Make a short (Mist): back, the short's name and quoted prompt; the 176×220 preview beside the
// draft scores; what the editor watched and what the draft changed; and a bottom bar to adjust
// the cut or export 1080p. While the agent runs, its live steps show under the header.
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { AgentSteps } from '../components/AgentSteps';
import { DraftScoreCard } from '../components/DraftScoreCard';
import { DraftChanges, EditorWatched } from '../components/DraftStory';
import { LoadError } from '../components/LoadError';
import { ShortActions } from '../components/ShortActions';
import { ShortPreview } from '../components/ShortPreview';
import { TimelineEditor } from '../components/TimelineEditor';
import { draftStory, isShortWorking, pickBestVersion, shortName, shortStatusLabel } from '../core/agent-trail';
import { shotNames } from '../core/humanize';
import { timelineLength } from '../core/timeline-edit';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { useShort } from '../hooks/useEditor';
import { usePlayableProps } from '../hooks/usePlayableProps';
import { usePlayerProps } from '../hooks/usePlayerProps';
import { useTimelineDraft } from '../hooks/useTimelineDraft';
import type { AgentStep, ShortDetail, ShortVersion } from '../services/api/types';
import './ShortPage.css';

function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <button
      type="button"
      className="short-page__back"
      aria-label="Back"
      onClick={() => {
        if (location.key === 'default') void navigate('/shorts');
        else void navigate(-1);
      }}
    >
      <Icon name="back" size="md" />
    </button>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="short-page__header">
      <BackButton />
      <div className="short-page__heading">
        <h1 className="short-page__title">{title}</h1>
        <span className="short-page__subtitle">{subtitle}</span>
      </div>
    </header>
  );
}

function Working({ steps, label }: { steps: AgentStep[]; label: string }) {
  return (
    <section className="short-page__working" aria-label="The editor at work">
      <p className="short-page__status" role="status">
        <Spinner /> {label}
      </p>
      <AgentSteps steps={steps} isWorking />
    </section>
  );
}

interface DraftProps {
  detail: ShortDetail;
  shown: ShortVersion;
  onSaved: (n: number) => void;
  refresh: () => void;
}

function Draft({ detail, shown, onSaved, refresh }: DraftProps) {
  const [isAdjusting, setAdjusting] = useState(false);
  const draft = useTimelineDraft(detail.short.short_id, shown, detail.segments);
  // The Player follows the draft: reorder, drop and trim show before anything is saved.
  // In the Mac app the shots then read synced proxies from disk (identity in the PWA).
  const cloudProps = usePlayerProps(shown.composition_props, draft.clips);
  const playerProps = usePlayableProps(cloudProps, detail.segments);
  const story = draftStory(shown, detail.versions);
  const previous = detail.versions.find((v) => v.n === shown.timeline.revision?.from_version) ?? null;
  const names = useMemo(
    () => shotNames([shown.timeline.clips, previous?.timeline.clips ?? []], detail.segments),
    [shown, previous, detail.segments],
  );
  const isWorking = isShortWorking(detail.short.status);
  const desktop = useDesktopSlots();

  const lengthS = timelineLength(draft.clips);

  return (
    <>
      {desktop === null ? (
        <div className="short-page__top">
          <ShortPreview version={shown} playerProps={playerProps} lengthS={lengthS} isWorking={isWorking} />
          <DraftScoreCard shown={shown} first={story.first} previous={previous} />
        </div>
      ) : (
        <div className="short-page__mac">
          <div className="short-page__mac-left">
            <ShortPreview
              version={shown}
              playerProps={playerProps}
              lengthS={lengthS}
              isWorking={isWorking}
              // Mock M2 badge: "v2 · 0:15 · from disk" once the shots read synced proxies.
              {...(playerProps !== null && playerProps !== cloudProps ? { badgeSuffix: 'from disk' } : {})}
            />
            <desktop.ShortScore shown={shown} first={story.first} />
          </div>
          <desktop.ShortFinish detail={detail} shown={shown} names={names} />
        </div>
      )}
      {story.watched !== null && <EditorWatched watched={story.watched} names={names} />}
      <DraftChanges shown={shown} versions={detail.versions} names={names} />
      <ShortActions
        short={detail.short}
        versionN={shown.n}
        caption={shown.timeline.post.caption}
        isWorking={isWorking}
        refresh={refresh}
        onAdjust={() => {
          setAdjusting(true);
        }}
      />
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
            onSaved(n);
          }}
        />
      </Sheet>
    </>
  );
}

function Loading() {
  return (
    <div className="short-page">
      <Header title="Short" subtitle="" />
      <div className="short-page__skeleton" aria-busy="true">
        <p className="visually-hidden" role="status">
          Loading the short…
        </p>
        <Skeleton kind="video" />
        <Skeleton kind="line" />
        <Skeleton kind="line-short" />
      </div>
    </div>
  );
}

/**
 * Shows one short by route id.
 * @returns The page.
 */
export function ShortPage() {
  const { id = '' } = useParams();
  const { state, steps, refresh } = useShort(id);
  const [selected, setSelected] = useState<number | null>(null);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <div className="short-page">
        <Header title="Short" subtitle="" />
        <LoadError error={state.error} thing="short" onRetry={refresh} />
      </div>
    );
  }

  const detail = state.data;
  const working = isShortWorking(detail.short.status);
  const best = pickBestVersion(detail.versions, detail.short.best_version);
  const shownN = selected !== null && detail.versions.some((v) => v.n === selected) ? selected : best;
  const shown = detail.versions.find((v) => v.n === shownN);
  const subtitle = `“${detail.short.prompt}” · ${detail.short.aspect}`;

  return (
    <div className="short-page">
      <Header title={shortName(shown)} subtitle={subtitle} />
      {working && <Working steps={steps} label={shortStatusLabel(detail.short.status)} />}
      {shown === undefined ? (
        detail.short.status === 'failed' ? (
          <EmptyState icon="shorts" title="The editor stopped" body="No draft was finished. Try again with other moments." />
        ) : (
          <div className="short-page__top">
            <ShortPreview version={null} playerProps={null} lengthS={null} isWorking={working} />
          </div>
        )
      ) : (
        <Draft key={shown.n} detail={detail} shown={shown} onSaved={setSelected} refresh={refresh} />
      )}
    </div>
  );
}
