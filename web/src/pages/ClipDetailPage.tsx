// Clip (P3): full-width player with moment markers on the scrubber and the ⋯ menu (make a short,
// delete); the title, when and how long, and status badges in words and icons; then a Moments |
// People | Said switch (one list at a time; "Name?" opens the naming sheet); and a sticky "Make a
// short from this clip". Taps on a moment or a line seek the player; `?t=` opens at a second.
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ClipActions } from '../components/ClipActions';
import { ClipPlayer } from '../components/ClipPlayer';
import { ClipFindThis } from '../components/ClipFindThis';
import { useObjectPick } from '../hooks/useObjectPick';
import { ClipStatusLine } from '../components/ClipStatusLine';
import { DuplicateBanner } from '../components/DuplicateBanner';
import { LoadError } from '../components/LoadError';
import { PeopleRow } from '../components/PeopleRow';
import { PersonSheet } from '../components/PersonSheet';
import { SegmentStrip } from '../components/SegmentStrip';
import { SpeakerSheet } from '../components/SpeakerSheet';
import { TranscriptList } from '../components/TranscriptList';
import { clipMetaLine, isInProgress, visibleTracks } from '../core/clip-view';
import { NAV_COPY } from '../core/copy';
import { dayTimeLabel } from '../core/day-groups';
import { formatDuration } from '../core/format';
import { handoffFromClip, readStartParam, type EditorHandoff } from '../core/selection';
import { activeIndex } from '../core/timeline';
import { buttonClassName } from '../design/Button';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { SegmentedControl } from '../design/SegmentedControl';
import { Skeleton } from '../design/Skeleton';
import { useClip } from '../hooks/useClips';
import { useDesktopSlots } from '../hooks/desktop-slots';
import { usePlayableUrl } from '../hooks/usePlayableUrl';
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

/** Which list the clip page shows. */
type ClipTab = 'moments' | 'people' | 'said';

function ClipBody({ detail, startSeconds }: { detail: ClipDetail; startSeconds: number | null }) {
  const navigate = useNavigate();
  const { ref, currentTime, seek, onTimeUpdate, onLoadedMetadata } = useVideoSeek(startSeconds);
  const naming = useNaming(detail);
  const pick = useObjectPick(detail.clip.clip_id);
  const desktop = useDesktopSlots();
  const proxyUrl = usePlayableUrl('proxy', detail.clip.clip_id, detail.proxy_url);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(null);
  const [tab, setTab] = useState<ClipTab>('moments');
  const { clip, segments, turns } = detail;
  const { tracks, speakers } = naming;
  const segmentIndex = activeIndex(segments, currentTime);
  const makeShort =
    segments.length === 0
      ? null
      : () => {
          const handoff: EditorHandoff = handoffFromClip(detail);
          void navigate('/editor', { state: handoff });
        };
  const turnIndex = activeIndex(turns, currentTime);
  const meta = clipMetaLine({
    when: clip.recorded_at === null ? '' : dayTimeLabel(clip.recorded_at, new Date()),
    duration: clip.duration_s === null ? '' : formatDuration(clip.duration_s),
    moments: 0,
    people: 0,
  });
  const tabs = [
    { value: 'moments', label: segments.length > 0 ? `Moments ${String(segments.length)}` : 'Moments' },
    { value: 'people', label: tracks.length > 0 ? `People ${String(tracks.length)}` : 'People' },
    { value: 'said', label: NAV_COPY.speech },
  ] as const;

  return (
    <div className="clip-detail-page">
      <ClipPlayer
        src={proxyUrl}
        poster={segments[0]?.thumb_url ?? clip.thumb_url}
        segments={segments}
        videoRef={ref}
        currentTime={currentTime}
        onSeek={seek}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        {...(clip.status === 'duplicate' ? { noPreviewText: 'No preview: this is a copy' } : {})}
        actions={<ClipActions clipId={clip.clip_id} title={clip.title} onMakeShort={makeShort} />}
        {...(proxyUrl === null ? {} : { pick })}
      />
      <div className="clip-detail-page__body">
        {clip.duplicate_of !== null && <DuplicateBanner clipId={clip.clip_id} originalId={clip.duplicate_of} />}
        <div className="clip-detail-page__heading">
          <h1 className="clip-detail-page__title">{clip.title}</h1>
          <span className="clip-detail-page__badges">
            <span className="clip-detail-page__meta">{meta}</span>
            {clip.status === 'ready' && (
              <Chip tone="success">
                <Icon name="check" size="xs" />
                Ready
              </Chip>
            )}
            {desktop === null && clip.status !== 'duplicate' && (
              <Chip>
                <Icon name="cloud" size="xs" />
                Plays from the cloud
              </Chip>
            )}
          </span>
          {isInProgress(clip.status) && (
            <ClipStatusLine clipId={clip.clip_id} status={clip.status} isLive />
          )}
        </div>
        {desktop !== null && clip.status === 'ready' && <desktop.ClipOffline clipId={clip.clip_id} />}
        {proxyUrl !== null && clip.status === 'ready' && (
          <ClipFindThis
            clipId={clip.clip_id}
            pick={pick}
            onSeek={seek}
            onStart={() => {
              ref.current?.pause();
            }}
          />
        )}
        {clip.status !== 'duplicate' && (
          <>
            <div className="clip-detail-page__switch">
              <SegmentedControl label="Show" options={tabs} value={tab} onChange={setTab} />
            </div>
            <section className="clip-detail-page__section" aria-label={tabs.find((t) => t.value === tab)?.label}>
              {tab === 'moments' &&
                (segments.length === 0 ? (
                  <Muted>Moments appear here once the clip is processed.</Muted>
                ) : (
                  <SegmentStrip segments={segments} activeIndex={segmentIndex} onSeek={seek} />
                ))}
              {tab === 'people' &&
                (tracks.length === 0 ? <Muted>No faces found yet.</Muted> : <PeopleRow tracks={tracks} onSelect={setEditingTrack} />)}
              {tab === 'said' &&
                (turns.length === 0 ? (
                  <Muted>No speech transcribed yet.</Muted>
                ) : (
                  <TranscriptList
                    turns={turns}
                    speakers={speakers}
                    activeIndex={turnIndex}
                    onSeek={seek}
                    onRenameSpeaker={setEditingSpeaker}
                  />
                ))}
            </section>
          </>
        )}
      </div>
      {makeShort !== null && (
        <div className="clip-detail-page__cta">
          <button type="button" className={`${buttonClassName('primary', 'lg')} clip-detail-page__make`} onClick={makeShort}>
            <Icon name="sparkle" size="sm" />
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
