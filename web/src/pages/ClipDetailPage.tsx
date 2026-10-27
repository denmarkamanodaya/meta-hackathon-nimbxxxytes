// Clip (Mist): full-width player with moment markers, the clip title and meta line, then
// Moments, People ("Name?" opens the naming sheet) and what was Said, with "Make a short from
// this clip" at the bottom. Taps on a moment or a line seek the player; `?t=` opens at a second.
import { useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ClipPlayer } from '../components/ClipPlayer';
import { ClipStatusLine } from '../components/ClipStatusLine';
import { DuplicateBanner } from '../components/DuplicateBanner';
import { LoadError } from '../components/LoadError';
import { PeopleRow } from '../components/PeopleRow';
import { PersonSheet } from '../components/PersonSheet';
import { SegmentStrip } from '../components/SegmentStrip';
import { SpeakerSheet } from '../components/SpeakerSheet';
import { TranscriptList } from '../components/TranscriptList';
import { clipMetaLine, isInProgress, visibleTracks } from '../core/clip-view';
import { dayTimeLabel } from '../core/day-groups';
import { formatDuration } from '../core/format';
import { handoffFromClip, readStartParam, type EditorHandoff } from '../core/selection';
import { activeIndex } from '../core/timeline';
import { buttonClassName } from '../design/Button';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { useClip } from '../hooks/useClips';
import { useOptimisticPatches } from '../hooks/useOptimisticPatches';
import { useServices } from '../hooks/services-context';
import { useVideoSeek } from '../hooks/useVideoSeek';
import type { ClipDetail, Speaker, Track } from '../services/api/types';
import './ClipDetailPage.css';

function Muted({ children }: { children: string }) {
  return <p className="clip-detail-page__muted">{children}</p>;
}

const trackId = (track: Track) => track.track_id;
const speakerId = (speaker: Speaker) => speaker.speaker_id;

/** Optimistic naming of faces and speakers for one clip. */
function useNaming(detail: ClipDetail) {
  const { api, toasts } = useServices();
  const trackEdits = useOptimisticPatches(trackId, (error) => {
    toasts.error('Could not save the name', error);
  });
  const speakerEdits = useOptimisticPatches(speakerId, (error) => {
    toasts.error('Could not rename the speaker', error);
  });
  return {
    tracks: visibleTracks(trackEdits.apply(detail.tracks)),
    speakers: speakerEdits.apply(detail.speakers),
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

function ClipSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="clip-detail-page__section" aria-label={label}>
      <h2 className="clip-detail-page__label">{label}</h2>
      {children}
    </section>
  );
}

function ClipBody({ detail, startSeconds }: { detail: ClipDetail; startSeconds: number | null }) {
  const navigate = useNavigate();
  const { ref, currentTime, seek, onTimeUpdate, onLoadedMetadata } = useVideoSeek(startSeconds);
  const naming = useNaming(detail);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(null);
  const { clip, segments, turns } = detail;
  const { tracks, speakers } = naming;
  const segmentIndex = activeIndex(segments, currentTime);
  const turnIndex = activeIndex(turns, currentTime);
  const meta = clipMetaLine({
    when: clip.recorded_at === null ? '' : dayTimeLabel(clip.recorded_at, new Date()),
    duration: clip.duration_s === null ? '' : formatDuration(clip.duration_s),
    moments: segments.length,
    people: tracks.length,
  });

  return (
    <div className="clip-detail-page">
      <ClipPlayer
        src={detail.proxy_url}
        poster={segments[0]?.thumb_url ?? clip.thumb_url}
        segments={segments}
        videoRef={ref}
        currentTime={currentTime}
        onSeek={seek}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        {...(clip.status === 'duplicate' ? { noPreviewText: 'No preview: this is a copy' } : {})}
      />
      <div className="clip-detail-page__body">
        {clip.duplicate_of !== null && <DuplicateBanner clipId={clip.clip_id} originalId={clip.duplicate_of} />}
        <div className="clip-detail-page__heading">
          <h1 className="clip-detail-page__title">{clip.title}</h1>
          <span className="clip-detail-page__meta">{meta}</span>
          {isInProgress(clip.status) && (
            <ClipStatusLine clipId={clip.clip_id} status={clip.status} isLive />
          )}
        </div>
        {clip.status !== 'duplicate' && (
          <>
            <ClipSection label="Moments">
              {segments.length === 0 ? (
                <Muted>Moments appear here once the clip is processed.</Muted>
              ) : (
                <SegmentStrip segments={segments} activeIndex={segmentIndex} onSeek={seek} />
              )}
            </ClipSection>
            <ClipSection label="People">
              {tracks.length === 0 ? <Muted>No faces found yet.</Muted> : <PeopleRow tracks={tracks} onSelect={setEditingTrack} />}
            </ClipSection>
            <ClipSection label="Said">
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
            </ClipSection>
          </>
        )}
      </div>
      {segments.length > 0 && (
        <div className="clip-detail-page__cta">
          <button
            type="button"
            className={`${buttonClassName('primary', 'lg')} clip-detail-page__make`}
            onClick={() => {
              const handoff: EditorHandoff = handoffFromClip(detail);
              void navigate('/editor', { state: handoff });
            }}
          >
            <Icon name="shorts" size="sm" />
            Make a short from this clip
          </button>
        </div>
      )}
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
    </div>
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
  const { state, refresh } = useClip(id);

  if (state.status === 'ready') return <ClipBody detail={state.data} startSeconds={startSeconds} />;
  return (
    <div className="clip-detail-page">
      <div className="clip-detail-page__placeholder" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <Skeleton kind="video" />}
      </div>
      <div className="clip-detail-page__body">
        {state.status === 'loading' && (
          <div className="clip-detail-page__skeleton">
            <p className="visually-hidden" role="status">
              Loading clip…
            </p>
            <Skeleton kind="title" />
            <Skeleton kind="line-short" />
            <div className="clip-detail-page__skeleton-row">
              <Skeleton kind="avatar" />
              <Skeleton kind="avatar" />
            </div>
            <Skeleton kind="line" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="clip" onRetry={refresh} />}
      </div>
    </div>
  );
}
