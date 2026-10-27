// A clip on the Mac (redesign v2, V3): "‹ Gallery / title", when, how long, and how it plays
// (streaming or kept, and what this Mac holds of it); the player; and the clip's details on the
// right, whose Speech list follows playback. `?t=` opens at a second.
import { Link, useParams, useSearchParams } from 'react-router';
import { MacColumns } from '../../components/desktop/MacColumns';
import { MacPlayer } from '../../components/desktop/MacPlayer';
import { AvailabilityIcon } from '../../components/desktop/AvailabilityIcon';
import { LoadError } from '../../components/LoadError';
import { NAV_COPY } from '../../core/copy';
import { dayLabel } from '../../core/day-groups';
import { formatDuration } from '../../core/format';
import { clipAvailability, clipStreamLine } from '../../core/on-this-mac';
import { readStartParam } from '../../core/selection';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { useClip } from '../../hooks/useClips';
import { useSyncStatus } from '../../hooks/useDesktop';
import { usePlayableUrl } from '../../hooks/usePlayableUrl';
import { useVideoSeek } from '../../hooks/useVideoSeek';
import type { ClipDetail } from '../../services/api/types';
import './MacClipPage.css';

function Header({ detail }: { detail: ClipDetail | null }) {
  const { state } = useSyncStatus();
  const clip = detail?.clip;
  const status = state.status === 'ready' ? state.data : null;
  const meta = clip === undefined ? [] : [clip.recorded_at === null ? '' : dayLabel(clip.recorded_at, new Date()), clip.duration_s === null ? '' : formatDuration(clip.duration_s)].filter((part) => part !== '');
  return (
    <header className="mac-columns__head mac-clip__head">
      <Link className="mac-clip__back" to="/">
        <Icon name="back" size="xs" />
        {NAV_COPY.gallery}
      </Link>
      <span className="mac-clip__slash" aria-hidden="true">
        /
      </span>
      <h1 className="mac-clip__title">{clip?.title ?? ''}</h1>
      {meta.length > 0 && <span className="mac-clip__meta">{meta.join(' · ')}</span>}
      <span className="mac-clip__spacer" />
      {clip !== undefined && (
        <span className="mac-clip__stream">
          <AvailabilityIcon state={clipAvailability(clip.clip_id, status)} />
          {clipStreamLine(clip.clip_id, status)}
        </span>
      )}
    </header>
  );
}

function ClipBody({ detail, startSeconds }: { detail: ClipDetail; startSeconds: number | null }) {
  const video = useVideoSeek(startSeconds);
  const src = usePlayableUrl('proxy', detail.clip.clip_id, detail.proxy_url);
  const poster = detail.segments[0]?.thumb_url ?? detail.clip.thumb_url;
  return (
    <MacColumns asideLabel="Clip details" aside={null}>
      <Header detail={detail} />
      <div className="mac-clip__player">
        <MacPlayer detail={detail} src={src} poster={poster} video={video} />
      </div>
    </MacColumns>
  );
}

/**
 * The clip page.
 * @returns The page.
 */
export function MacClipPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const startSeconds = readStartParam(params.get('t'));
  const { state, refresh } = useClip(id);
  if (state.status === 'ready') return <ClipBody key={id} detail={state.data} startSeconds={startSeconds} />;
  return (
    <MacColumns asideLabel="Clip details" aside={null}>
      <Header detail={null} />
      <div className="mac-clip__player">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading clip…
            </p>
            <Skeleton kind="video" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="clip" onRetry={refresh} />}
      </div>
    </MacColumns>
  );
}
