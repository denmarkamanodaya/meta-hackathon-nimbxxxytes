// A clip on the Mac (redesign v2, V3): "‹ Gallery / title", when, how long and how big, and how
// it plays (streaming or kept, and what this Mac holds of it); the player; and the clip panel on
// the right: the tabs, opened on Speech, whose list follows playback, then Make a short, Make
// available offline and Add to project. `?t=` opens at a second.
import { useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AddToProjectButton,
  ClipPanel,
  ClipPanelButtons,
  ClipPanelFooter,
  ClipPanelTabs,
  MakeShortButton,
  OfflineButton,
} from '../../components/desktop/ClipPanel';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacPlayer } from '../../components/desktop/MacPlayer';
import { FindPanel } from '../../components/desktop/FindPanel';
import { MacDialog } from '../../components/desktop/MacDialog';
import { CutoutView, cutoutTitle } from '../../components/CutoutView';
import { Icon } from '../../design/Icon';
import { purposeOf, useObjectPick } from '../../hooks/useObjectPick';
import { PlayerSpeech } from '../../components/desktop/PlayerSpeech';
import { AvailabilityIcon } from '../../components/desktop/AvailabilityIcon';
import { LoadError } from '../../components/LoadError';
import { CUTOUT_COPY, FIND_COPY, NAV_COPY } from '../../core/copy';
import { panelMetaLine } from '../../core/gallery';
import { clipAvailability, clipStreamLine } from '../../core/on-this-mac';
import { handoffFromRange, readStartParam } from '../../core/selection';
import { Skeleton } from '../../design/Skeleton';
import { useClip, useCopySpeech } from '../../hooks/useClips';
import { useSyncStatus } from '../../hooks/useDesktop';
import { usePlayableUrl } from '../../hooks/usePlayableUrl';
import { useVideoSeek } from '../../hooks/useVideoSeek';
import type { ClipDetail } from '../../services/api/types';
import './MacClipPage.css';

/** The clip panel's name for assistive tech. */
const ASIDE_LABEL = 'Clip details';
/** The right column's name while Find this is on. */
const FIND_ASIDE_LABEL = FIND_COPY.asideLabel;

function Header({ detail }: { detail: ClipDetail | null }) {
  const { state } = useSyncStatus();
  const clip = detail?.clip;
  const status = state.status === 'ready' ? state.data : null;
  return (
    <header className="mac-columns__head mac-clip__head">
      <MacCrumb to="/" label={NAV_COPY.gallery} />
      <h1 className="mac-clip__title">{clip?.title ?? ''}</h1>
      {clip !== undefined && <span className="mac-clip__meta">{panelMetaLine(clip, [])}</span>}
      <span className="mac-clip__spacer" />
      {clip !== undefined && (
        <span className="mac-clip__stream">
          <AvailabilityIcon state={clipAvailability(clip.clip_id, status)} size="bare" />
          {clipStreamLine(clip.clip_id, status)}
        </span>
      )}
    </header>
  );
}

function ClipBody({ detail, startSeconds }: { detail: ClipDetail; startSeconds: number | null }) {
  const navigate = useNavigate();
  const video = useVideoSeek(startSeconds);
  const pick = useObjectPick(detail.clip.clip_id);
  const isFinding = purposeOf(pick.state) === 'find';
  const copy = useCopySpeech();
  const src = usePlayableUrl('proxy', detail.clip.clip_id, detail.proxy_url);
  const poster = detail.segments[0]?.thumb_url ?? detail.clip.thumb_url;
  const speech = (
    <PlayerSpeech
      turns={detail.turns}
      speakers={detail.speakers}
      currentTime={video.currentTime}
      onSeek={video.seek}
      onUse={(turn) => {
        void navigate('/editor', { state: handoffFromRange(detail, turn) });
      }}
      onCopy={(text) => {
        void copy(text);
      }}
    />
  );
  return (
    <MacColumns
      asideLabel={isFinding ? FIND_ASIDE_LABEL : ASIDE_LABEL}
      aside={
        isFinding ? (
          <FindPanel clipId={detail.clip.clip_id} found={pick.state.phase === 'found' ? pick.state.found : null} onSeek={video.seek} />
        ) : (
        <ClipPanel key={detail.clip.clip_id}>
          <ClipPanelTabs clip={detail.clip} detail={detail} defaultTab="speech" onSeek={video.seek} speech={speech} />
          <ClipPanelFooter>
            <MakeShortButton clip={detail.clip} detail={detail}>
              Make a short
            </MakeShortButton>
            <ClipPanelButtons>
              <OfflineButton clip={detail.clip} />
              <AddToProjectButton clip={detail.clip}>Add to project</AddToProjectButton>
            </ClipPanelButtons>
          </ClipPanelFooter>
        </ClipPanel>
        )
      }
    >
      <Header detail={detail} />
      <div className="mac-clip__player">
        <MacPlayer detail={detail} src={src} poster={poster} video={video} pick={pick} />
      </div>
      <MacDialog
        open={pick.state.phase === 'cut'}
        label={pick.state.phase === 'cut' ? cutoutTitle(pick.state.cutout.label) : CUTOUT_COPY.title}
        onClose={pick.cancel}
        className="cutout-dialog"
      >
        {pick.state.phase === 'cut' && (
          <CutoutView
            cutout={pick.state.cutout}
            atS={pick.state.point.t_s}
            buttonClass="mac-button"
            primaryClass="mac-button mac-button--primary"
            close={
              <button type="button" className="mac-button mac-button--icon cutout-dialog__close" aria-label={CUTOUT_COPY.close} onClick={pick.cancel}>
                <Icon name="close" size="xs" />
              </button>
            }
          />
        )}
      </MacDialog>
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
    <MacColumns asideLabel={ASIDE_LABEL} aside={null}>
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
