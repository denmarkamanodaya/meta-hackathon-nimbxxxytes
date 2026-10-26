// Clip detail page: proxy video, the scene under the playhead, scenes strip, people and
// transcript. Taps on a scene or transcript line seek the player; `?t=` opens at a second.
// Faces and speakers are named in bottom sheets with optimistic updates.
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ClipStatusLine } from '../components/ClipStatusLine';
import { NowPlaying } from '../components/NowPlaying';
import { PeopleRow } from '../components/PeopleRow';
import { PersonSheet } from '../components/PersonSheet';
import { SegmentStrip } from '../components/SegmentStrip';
import { SpeakerSheet } from '../components/SpeakerSheet';
import { TranscriptList } from '../components/TranscriptList';
import { isInProgress, visibleTracks } from '../core/clip-view';
import { formatDuration, formatShortDate } from '../core/format';
import { readStartParam } from '../core/selection';
import { activeIndex } from '../core/timeline';
import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Section } from '../design/Section';
import { Spinner } from '../design/Spinner';
import { useClip } from '../hooks/useClips';
import { useOptimisticPatches } from '../hooks/useOptimisticPatches';
import { useServices } from '../hooks/services-context';
import { useVideoSeek } from '../hooks/useVideoSeek';
import type { ClipDetail, Speaker, Track } from '../services/api/types';
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

const trackId = (track: Track) => track.track_id;
const speakerId = (speaker: Speaker) => speaker.speaker_id;

/** Optimistic naming of faces and speakers for one clip. */
function useNaming(detail: ClipDetail) {
  const { api } = useServices();
  const trackEdits = useOptimisticPatches(trackId);
  const speakerEdits = useOptimisticPatches(speakerId);
  return {
    tracks: visibleTracks(trackEdits.apply(detail.tracks)),
    speakers: speakerEdits.apply(detail.speakers),
    error: trackEdits.error ?? speakerEdits.error,
    nameTrack: (track: Track, name: string) =>
      void trackEdits.commit(track.track_id, { person_name: name }, () =>
        api.updateTrack(track.track_id, { name }),
      ),
    hideTrack: (track: Track) =>
      void trackEdits.commit(track.track_id, { hidden: true }, () =>
        api.updateTrack(track.track_id, { hidden: true }),
      ),
    renameSpeaker: (speaker: Speaker, displayName: string) =>
      void speakerEdits.commit(speaker.speaker_id, { display_name: displayName }, () =>
        api.updateSpeaker(speaker.speaker_id, { display_name: displayName }),
      ),
  };
}

function ClipBody({ detail, startSeconds }: { detail: ClipDetail; startSeconds: number | null }) {
  const { ref, currentTime, seek, onTimeUpdate, onLoadedMetadata } = useVideoSeek(startSeconds);
  const naming = useNaming(detail);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(null);
  const { clip, segments, turns } = detail;
  const { tracks, speakers } = naming;
  const segmentIndex = activeIndex(segments, currentTime);
  const turnIndex = activeIndex(turns, currentTime);
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
            onLoadedMetadata={onLoadedMetadata}
          />
        )}
      </div>
      {naming.error !== null && (
        <p className="clip-detail-page__error" role="alert">
          {`Could not save the name: ${naming.error}`}
        </p>
      )}
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
          <PeopleRow tracks={tracks} onSelect={setEditingTrack} />
        )}
      </Section>
      <Section title="Transcript">
        {turns.length === 0 ? (
          <Muted>No speech transcribed yet.</Muted>
        ) : (
          <TranscriptList
            turns={turns}
            speakers={speakers}
            activeIndex={turnIndex}
            onSeek={seek}
            onRenameSpeaker={setEditingSpeaker}
          />
        )}
      </Section>
      <PersonSheet
        track={editingTrack}
        onClose={() => {
          setEditingTrack(null);
        }}
        onName={naming.nameTrack}
        onHide={naming.hideTrack}
        onPlay={seek}
      />
      <SpeakerSheet
        speaker={editingSpeaker}
        onClose={() => {
          setEditingSpeaker(null);
        }}
        onRename={naming.renameSpeaker}
      />
    </>
  );
}

/**
 * Shows one clip by its route id.
 * @returns The page.
 */
export function ClipDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const startSeconds = readStartParam(params.get('t'));
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
      {state.status === 'ready' && <ClipBody detail={state.data} startSeconds={startSeconds} />}
    </>
  );
}
