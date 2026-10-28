// What pick mode draws over a clip's video (boards V18, V22), on the Mac player and the PWA clip
// player alike: while picking, a crosshair layer that turns a click on the picture into 0..1 of the
// frame (a click on a letterbox bar does nothing) and the hint; while the call runs, the veil;
// once found, the object's outline (frame pixels laid over the picture, holes kept by evenodd) and
// the label chip. Outside pick mode it draws nothing, so the video keeps its click-to-play.
import { useEffect, useState, type RefObject } from 'react';
import { FIND_COPY } from '../core/copy';
import { chipText } from '../core/find-this';
import { clickToFrame, frameToElement, pictureBoxPercent, type Size, type VideoFit } from '../core/video-point';
import { Spinner } from '../design/Spinner';
import type { PickState } from '../hooks/useObjectPick';
import type { FramePoint } from '../services/api/types';
import './PickOverlay.css';

/** Props for `PickOverlay`. */
export interface PickOverlayProps {
  state: PickState;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The video's CSS `object-fit`. */
  fit: VideoFit;
  /** Says tap instead of click and leaves out Esc (the PWA). */
  isTouch?: boolean;
  onPick: (point: FramePoint) => void;
}

interface Measure {
  element: Size;
  media: Size;
}

const pct = (value: number) => `${String(value)}%`;

/** The video element's size and its picture's size, measured again on resize. */
function useVideoMeasure(videoRef: RefObject<HTMLVideoElement | null>, isNeeded: boolean): Measure | null {
  const [measure, setMeasure] = useState<Measure | null>(null);
  useEffect(() => {
    if (!isNeeded) return undefined;
    const read = () => {
      const video = videoRef.current;
      if (video === null) return;
      setMeasure({
        element: { width: video.clientWidth, height: video.clientHeight },
        media: { width: video.videoWidth, height: video.videoHeight },
      });
    };
    read();
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('resize', read);
    };
  }, [videoRef, isNeeded]);
  return measure;
}

/**
 * The overlay; place it inside the video's positioned stage, over the video.
 * @param props - See `PickOverlayProps`.
 * @returns The overlay, or nothing when pick mode is off.
 */
export function PickOverlay({ state, videoRef, fit, isTouch = false, onPick }: PickOverlayProps) {
  const measure = useVideoMeasure(videoRef, state.phase === 'found');
  if (state.phase === 'off' || state.phase === 'cut') return null;

  if (state.phase === 'picking') {
    const hint =
      state.purpose === 'find' ? (isTouch ? FIND_COPY.pickHintTouch : FIND_COPY.pickHint) : isTouch ? FIND_COPY.cutHintTouch : FIND_COPY.cutHint;
    return (
      <div
        className="pick-overlay pick-overlay--picking"
        role="button"
        tabIndex={-1}
        aria-label={hint}
        onClick={(event) => {
          event.stopPropagation();
          const video = videoRef.current;
          if (video === null) return;
          const rect = video.getBoundingClientRect();
          const share = clickToFrame(
            { x: event.clientX, y: event.clientY },
            { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            { width: video.videoWidth, height: video.videoHeight },
            fit,
          );
          if (share !== null) onPick({ t_s: video.currentTime, x: share.x, y: share.y });
        }}
      >
        <span className="pick-overlay__hint">{hint}</span>
      </div>
    );
  }

  if (state.phase === 'working') {
    return (
      <div className="pick-overlay pick-overlay--veil" role="status">
        <Spinner />
        {state.purpose === 'find' ? FIND_COPY.tracking : FIND_COPY.cutting}
      </div>
    );
  }

  const { found, point } = state;
  const box = measure === null ? null : pictureBoxPercent(measure.element, measure.media, fit);
  const chipAt = measure === null ? null : frameToElement(point, measure.element, measure.media, fit);
  return (
    <div className="pick-overlay pick-overlay--found" aria-hidden="true">
      {found.outline !== null && box !== null && (
        <svg
          className="pick-overlay__outline"
          viewBox={`0 0 ${String(found.outline.frame_w)} ${String(found.outline.frame_h)}`}
          // The box already has the frame's aspect, so stretching cannot distort the outline.
          preserveAspectRatio="none"
          style={{ left: pct(box.left), top: pct(box.top), width: pct(box.width), height: pct(box.height) }}
        >
          <path d={found.outline.path} fillRule="evenodd" clipRule="evenodd" className="pick-overlay__fill" />
          <path d={found.outline.path} fillRule="evenodd" className="pick-overlay__stroke" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {chipAt !== null && (
        <span className="pick-overlay__chip" style={{ left: `${String(chipAt.x)}px`, top: `${String(chipAt.y)}px` }}>
          {chipText(found)}
        </span>
      )}
    </div>
  );
}
