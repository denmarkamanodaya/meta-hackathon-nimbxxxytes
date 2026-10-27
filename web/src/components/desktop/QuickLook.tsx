// Quick look (Space in the Gallery, or the clip menu): the clip's proxy playing in a sheet over the
// page, the local copy when it is on this Mac. Space or Esc closes it; nothing navigates away.
import { useEffect } from 'react';
import { formatDuration } from '../../core/format';
import { useClip } from '../../hooks/useClips';
import { usePlayableUrl } from '../../hooks/usePlayableUrl';
import type { ClipSummary } from '../../services/api/types';
import { MacDialog } from './MacDialog';
import './QuickLook.css';

function Preview({ clip, onClose }: { clip: ClipSummary; onClose: () => void }) {
  const { state } = useClip(clip.clip_id);
  const proxy = state.status === 'ready' ? state.data.proxy_url : null;
  const src = usePlayableUrl('proxy', clip.clip_id, proxy);
  const waiting =
    state.status === 'error' ? 'This clip cannot play right now.'
    : state.status === 'ready' && proxy === null ? 'No preview yet.'
    : 'Loading…';
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <figure className="quick-look">
      {src === null ? (
        <div className="quick-look__video quick-look__waiting">{waiting}</div>
      ) : (
        <video className="quick-look__video" src={src} poster={clip.thumb_url ?? undefined} autoPlay controls playsInline />
      )}
      <figcaption className="quick-look__caption">
        <span className="quick-look__title">{clip.title}</span>
        {clip.duration_s !== null && <span className="quick-look__meta">{formatDuration(clip.duration_s)}</span>}
        <span className="quick-look__hint">Space or Esc closes</span>
      </figcaption>
    </figure>
  );
}

/**
 * The sheet.
 * @param props - The clip to show (null keeps it closed) and `onClose`.
 * @returns The dialog.
 */
export function QuickLook({ clip, onClose }: { clip: ClipSummary | null; onClose: () => void }) {
  return (
    <MacDialog open={clip !== null} label={clip === null ? 'Quick look' : `Quick look: ${clip.title}`} onClose={onClose} className="quick-look-dialog">
      {clip !== null && <Preview clip={clip} onClose={onClose} />}
    </MacDialog>
  );
}
