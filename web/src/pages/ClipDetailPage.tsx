// Clip detail page: proxy video, the scene under the playhead, scenes strip, people and
// transcript. Every tap on a scene, person or transcript line seeks the player.
import { Link, useParams } from 'react-router';
import { ClipStatusLine } from '../components/ClipStatusLine';
import { NowPlaying } from '../components/NowPlaying';
import { PeopleRow } from '../components/PeopleRow';
import { SegmentStrip } from '../components/SegmentStrip';
import { TranscriptList } from '../components/TranscriptList';
import { isInProgress, visibleTracks } from '../core/clip-view';
import { formatDuration, formatShortDate } from '../core/format';
import { activeIndex } from '../core/timeline';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Section } from '../design/Section';
import { Spinner } from '../design/Spinner';
import { useClip } from '../hooks/useClips';
import { useVideoSeek } from '../hooks/useVideoSeek';
import type { ClipDetail } from '../services/api/types';
import './ClipDetailPage.css';

const backLink = (
  <Link to="/" className="clip-detail-page__back">
    <Icon name="back" />
    Library
  </Link>
);

function Muted({ children }: { children: string }) {
  return <p className="clip-detail-page__muted">{children}</p>;
}

function ClipBody({ detail }: { detail: ClipDetail }) {
  const { ref, currentTime, seek, onTimeUpdate } = useVideoSeek();
  const { clip, segments, turns, speakers } = detail;
  const segmentIndex = activeIndex(segments, currentTime);
  const turnIndex = activeIndex(turns, currentTime);
  const tracks = visibleTracks(detail.tracks);
  const active = segments[segmentIndex];
  const meta = [
    clip.recorded_at === null ? '' : formatShortDate(clip.recorded_at, new Date()),
    clip.duration_s === null ? '' : formatDuration(clip.duration_s),
  ].filter((part) => part !== '');

  return (
    <>
      <div className="clip-detail-page__meta">
        {meta.length > 0 && <span>{meta.join(' · ')}</span>}
        <ClipStatusLine clipId={clip.clip_id} status={clip.status} isLive={isInProgress(clip.status)} />
      </div>
      <div className="clip-detail-page__player">
        {detail.proxy_url === null ? (
          <div className="clip-detail-page__preparing" role="status">
            <Spinner />
            Preparing the preview…
          </div>
        ) : (
          <video
            ref={ref}
            className="clip-detail-page__video"
            src={detail.proxy_url}
            poster={segments[0]?.thumb_url ?? clip.thumb_url ?? undefined}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
          />
        )}
      </div>
      {active !== undefined && <NowPlaying segment={active} />}
      <Section title="Scenes" count={segments.length}>
        {segments.length === 0 ? (
          <Muted>Scenes appear here once the clip is processed.</Muted>
        ) : (
          <SegmentStrip segments={segments} activeIndex={segmentIndex} onSeek={seek} />
        )}
      </Section>
      <Section title="People in this clip" count={tracks.length}>
        {tracks.length === 0 ? (
          <Muted>No faces found yet.</Muted>
        ) : (
          <PeopleRow tracks={tracks} onSeek={seek} />
        )}
      </Section>
      <Section title="Transcript">
        {turns.length === 0 ? (
          <Muted>No speech transcribed yet.</Muted>
        ) : (
          <TranscriptList turns={turns} speakers={speakers} activeIndex={turnIndex} onSeek={seek} />
        )}
      </Section>
    </>
  );
}

/**
 * Shows one clip by its route id.
 * @returns The page.
 */
export function ClipDetailPage() {
  const { id = '' } = useParams();
  const state = useClip(id);
  const title = state.status === 'ready' ? state.data.clip.filename : 'Clip';

  return (
    <>
      <PageHeader eyebrow={backLink} title={title} />
      {state.status === 'loading' && (
        <p className="clip-detail-page__muted" role="status">
          <Spinner /> Loading clip…
        </p>
      )}
      {state.status === 'error' && (
        <EmptyState icon="cloud" title="Could not open this clip" body={state.message} />
      )}
      {state.status === 'ready' && <ClipBody detail={state.data} />}
    </>
  );
}
