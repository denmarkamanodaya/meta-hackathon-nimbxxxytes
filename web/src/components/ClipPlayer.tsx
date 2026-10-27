// Full-width clip player (Mist): the proxy video, a back button, a centre play/pause button,
// and a scrubber with a marker at each moment and mono times. Taps on the track seek.
import { useState, type ReactNode, type RefObject } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { formatDuration } from '../core/format';
import { markerPercents, scrubSeconds } from '../core/timeline';
import { Icon } from '../design/Icon';
import { Spinner } from '../design/Spinner';
import type { Segment } from '../services/api/types';
import './ClipPlayer.css';

/** Props for `ClipPlayer`. */
export interface ClipPlayerProps {
  src: string | null;
  poster: string | null;
  segments: readonly Segment[];
  videoRef: RefObject<HTMLVideoElement | null>;
  currentTime: number;
  onSeek: (seconds: number) => void;
  onTimeUpdate: () => void;
  onLoadedMetadata: () => void;
  /** Shown without a spinner when there will never be a preview (a duplicate); default: still preparing. */
  noPreviewText?: string;
  /** Controls at the top right (the ⋯ menu). */
  actions?: ReactNode;
}

/**
 * The player.
 * @param props - See `ClipPlayerProps`.
 * @returns The player block.
 */
export function ClipPlayer(props: ClipPlayerProps) {
  const { src, poster, segments, videoRef, currentTime, onSeek, noPreviewText } = props;
  const navigate = useNavigate();
  const location = useLocation();
  const [isPlaying, setPlaying] = useState(false);
  const [duration, setDuration] = useState(Number.NaN);
  const markers = markerPercents(segments, duration);
  const progress = Number.isFinite(duration) && duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const togglePlay = () => {
    const video = videoRef.current;
    if (video === null) return;
    if (video.paused) {
      video.play().catch(() => {
        // Recovers: playback can be refused; the button stays on Play.
      });
    } else {
      video.pause();
    }
  };

  return (
    <div className="clip-player">
      {src === null ? (
        <div className="clip-player__pending" role="status">
          {noPreviewText ?? (
            <>
              <Spinner />
              Preparing the preview…
            </>
          )}
        </div>
      ) : (
        <video
          ref={videoRef}
          className="clip-player__video"
          src={src}
          poster={poster ?? undefined}
          playsInline
          preload="metadata"
          onClick={togglePlay}
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onDurationChange={(event) => {
            setDuration(event.currentTarget.duration);
          }}
          onTimeUpdate={props.onTimeUpdate}
          onLoadedMetadata={props.onLoadedMetadata}
        />
      )}
      <button
        type="button"
        className="clip-player__back"
        aria-label="Back"
        onClick={() => {
          if (location.key === 'default') void navigate('/');
          else void navigate(-1);
        }}
      >
        <Icon name="back" size="md" />
      </button>
      {props.actions !== undefined && <div className="clip-player__actions">{props.actions}</div>}
      {src !== null && (
        <>
          <button type="button" className="clip-player__play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay}>
            <Icon name={isPlaying ? 'pause' : 'play'} />
          </button>
          <div className="clip-player__controls">
            <div
              className="clip-player__track"
              role="slider"
              tabIndex={0}
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={Number.isFinite(duration) ? Math.round(duration) : 0}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={formatDuration(currentTime)}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onSeek(scrubSeconds(event.clientX - rect.left, rect.width, duration));
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 5));
                if (event.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
              }}
            >
              <span className="clip-player__fill" style={{ width: `${String(progress)}%` }} />
              {markers.map((left, index) => (
                <span key={segments[index]?.segment_id ?? index} className="clip-player__marker" style={{ left: `${String(left)}%` }} />
              ))}
            </div>
            <div className="clip-player__times">
              <span>{formatDuration(currentTime)}</span>
              <span>{Number.isFinite(duration) ? formatDuration(duration) : '–:––'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
