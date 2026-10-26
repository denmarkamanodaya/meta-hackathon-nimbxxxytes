// Short page: the editing agent at work (live steps), then the critique trail v1 → v2 → v3 with
// the reasoning for every version, the editable timeline, and the final render.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AgentSteps } from '../components/AgentSteps';
import { FinalRender } from '../components/FinalRender';
import { LoadError } from '../components/LoadError';
import { TimelineEditor } from '../components/TimelineEditor';
import { VersionPanel } from '../components/VersionPanel';
import { VersionStepper } from '../components/VersionStepper';
import { isShortWorking, pickBestVersion, shortStatusLabel } from '../core/agent-trail';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Section } from '../design/Section';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useShort } from '../hooks/useEditor';
import { usePlayerProps } from '../hooks/usePlayerProps';
import { useTimelineDraft } from '../hooks/useTimelineDraft';
import type { AgentStep, ShortDetail, ShortVersion } from '../services/api/types';
import './ShortPage.css';

const backLink = (
  <Link to="/editor" className="short-page__back">
    <Icon name="back" />
    Editor
  </Link>
);

interface TrailProps {
  detail: ShortDetail;
  version: ShortVersion;
  best: number | null;
  onSelect: (n: number) => void;
  refresh: () => void;
}

function Trail({ detail, version, best, onSelect, refresh }: TrailProps) {
  const [seek, setSeek] = useState<{ n: number; at: number; token: number } | null>(null);
  const draft = useTimelineDraft(detail.short.short_id, version, detail.segments);
  const previous = detail.versions.find((candidate) => candidate.n === version.n - 1) ?? null;
  const startSeconds = seek?.n === version.n ? seek.at : null;
  // The Player follows the draft: reorder, drop and trim show before anything is saved.
  const playerProps = usePlayerProps(version.composition_props, draft.clips);

  return (
    <>
      <VersionStepper versions={detail.versions} selected={version.n} best={best} onSelect={onSelect} />
      <VersionPanel
        key={`${String(version.n)}-${String(seek?.token ?? 0)}`}
        version={version}
        versions={detail.versions}
        aspect={detail.short.aspect}
        startSeconds={startSeconds}
        playerProps={playerProps}
        isWorking={isShortWorking(detail.short.status)}
        onShowNote={(n, at) => {
          setSeek({ n, at, token: (seek?.token ?? 0) + 1 });
          onSelect(n);
        }}
      />
      <Section title={`Timeline · v${String(version.n)}`} count={draft.clips.length}>
        <TimelineEditor
          draft={draft}
          segments={detail.segments}
          previous={previous?.timeline.clips ?? null}
          targetSeconds={version.timeline.target_seconds}
          onSaved={(n) => {
            refresh();
            onSelect(n);
          }}
        />
      </Section>
      {version.timeline.post.caption !== '' && (
        <Section title="Post">
          <p className="short-page__caption">{version.timeline.post.caption}</p>
          <p className="short-page__tags">{version.timeline.post.hashtags.join(' ')}</p>
        </Section>
      )}
      <div className="short-page__final">
        <FinalRender short={detail.short} versionN={version.n} caption={version.timeline.post.caption} refresh={refresh} />
      </div>
    </>
  );
}

function Working({ steps, label }: { steps: AgentStep[]; label: string }) {
  return (
    <Section title="The editor at work">
      <p className="short-page__status" role="status">
        <Spinner /> {label}
      </p>
      <AgentSteps steps={steps} isWorking />
    </Section>
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

  if (state.status === 'loading') {
    return (
      <>
        <PageHeader eyebrow={backLink} title="Short" />
        <div className="short-page__skeleton" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading the short…
          </p>
          <Skeleton kind="line-short" />
          <Skeleton kind="title" />
          <Skeleton kind="video" />
          <Skeleton kind="line" />
          <Skeleton kind="line" />
          <Skeleton kind="line-short" />
        </div>
      </>
    );
  }
  if (state.status === 'error') {
    return (
      <>
        <PageHeader eyebrow={backLink} title="Short" />
        <LoadError error={state.error} thing="short" onRetry={refresh} />
      </>
    );
  }

  const detail = state.data;
  const working = isShortWorking(detail.short.status);
  const best = pickBestVersion(detail.versions, detail.short.best_version);
  const shownN = selected !== null && detail.versions.some((v) => v.n === selected) ? selected : best;
  const version = detail.versions.find((v) => v.n === shownN);

  return (
    <>
      <PageHeader eyebrow={backLink} title="Short" />
      <p className="short-page__prompt">{`“${detail.short.prompt}”`}</p>
      {working && <Working steps={steps} label={shortStatusLabel(detail.short.status)} />}
      {detail.short.status === 'failed' && version === undefined && (
        <EmptyState icon="editor" title="The editor stopped" body="No version was finished. Try again with other moments." />
      )}
      {version !== undefined && (
        <Trail detail={detail} version={version} best={best} onSelect={setSelected} refresh={refresh} />
      )}
      {!working && steps.length > 0 && (
        <details className="short-page__log">
          <summary>How the editor got here</summary>
          <AgentSteps steps={steps} isWorking={false} />
        </details>
      )}
    </>
  );
}
