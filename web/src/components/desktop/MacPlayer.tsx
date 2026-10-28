// The Mac clip player (redesign v2, V3): the proxy video with captions from Speech, a scrubber with
// a tick at each moment, a dot at each speech turn, the cached range and a hover preview; the
// control bar (play, ±10 s, frame steps, time, previous / next moment with the moment's caption,
// speed, volume, captions, loop, picture in picture, full screen); then the in and out points and
// "Make a short from this range". Keys work while the player has focus: Space, J K L, ← →, , .,
// I O, C and M.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router';
import { formatDuration } from '../../core/format';
import {
  bufferedPercent,
  FRAME_S,
  hoverLine,
  JUMP_S,
  markIn,
  markOut,
  momentCaption,
  nextMomentStart,
  nextShuttle,
  nextSpeed,
  playerKeyAction,
  previousMomentStart,
  rangeLine,
  rangeSpan,
  speedLabel,
  type PlayerAction,
  type Range,
} from '../../core/player';
import { handoffFromRange } from '../../core/selection';
import { activeIndex, clampSeek, markerPercents, scrubSeconds } from '../../core/timeline';
import { Icon } from '../../design/Icon';
import { Spinner } from '../../design/Spinner';
import type { VideoSeek } from '../../hooks/useVideoSeek';
import type { ClipDetail, SecondsRange } from '../../services/api/types';
import { FIND_COPY } from '../../core/copy';
import { inViewBand } from '../../core/find-this';
import { purposeOf, type ObjectPick, type PickPurpose } from '../../hooks/useObjectPick';
import { PickOverlay } from '../PickOverlay';
import { PlayerGlyph } from './PlayerGlyphs';
import './MacPlayer.css';

/** How often a backward shuttle steps, ms (the video element cannot play backward). */
const REVERSE_STEP_MS = 100;
/** The volume the slider starts at, percent (the mock's). */
const START_VOLUME = 70;

const pct = (value: number) => `${String(value)}%`;

/** The video's buffered ranges as plain pairs. */
function bufferedRanges(video: HTMLVideoElement): [number, number][] {
  const ranges: [number, number][] = [];
  for (let i = 0; i < video.buffered.length; i += 1) ranges.push([video.buffered.start(i), video.buffered.end(i)]);
  return ranges;
}

/** Props for `MacPlayer`. */
export interface MacPlayerProps {
  detail: ClipDetail;
  /** The playable proxy, or null while it is being made. */
  src: string | null;
  poster: string | null;
  /** The page's seek state, shared with the right column so it follows playback. */
  video: VideoSeek;
  /** Find this and Cut out (board V18); absent hides both buttons. */
  pick?: ObjectPick;
}

interface ScrubberProps {
  detail: ClipDetail;
  duration: number;
  currentTime: number;
  cachedPercent: number;
  onSeek: (seconds: number) => void;
  /** Where a found object is in view: an orange band over the track. */
  inView: SecondsRange | null;
}

function Scrubber({ detail, duration, currentTime, cachedPercent, onSeek, inView }: ScrubberProps) {
  const band = inView === null ? null : inViewBand(inView, duration);
  const [hover, setHover] = useState<number | null>(null);
  const [isDragging, setDragging] = useState(false);
  const played = Number.isFinite(duration) && duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const ticks = markerPercents(detail.segments, duration);
  const dots = markerPercents(detail.turns, duration);
  const at = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return scrubSeconds(event.clientX - rect.left, rect.width, duration);
  };
  const hoverSegment = hover === null ? undefined : detail.segments[activeIndex(detail.segments, hover)];
  return (
    <div
      className="mac-player__scrub"
      role="slider"
      tabIndex={-1}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Number.isFinite(duration) ? Math.round(duration) : 0}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={formatDuration(currentTime)}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        onSeek(at(event));
      }}
      onPointerMove={(event) => {
        const seconds = at(event);
        setHover(seconds);
        if (isDragging) onSeek(seconds);
      }}
      onPointerUp={() => {
        setDragging(false);
      }}
      onPointerLeave={() => {
        setHover(null);
      }}
    >
      {ticks.map((left, i) => (
        <span key={detail.segments[i]?.segment_id ?? i} className="mac-player__tick" style={{ left: pct(left) }} />
      ))}
      <span className="mac-player__track" />
      <span className="mac-player__cached" style={{ width: pct(cachedPercent) }} />
      <span className="mac-player__played" style={{ width: pct(played) }} />
      {dots.map((left, i) => (
        <span key={detail.turns[i]?.turn_id ?? i} className="mac-player__dot" style={{ left: pct(left) }} />
      ))}
      {band !== null && <span className="mac-player__in-view" style={{ left: pct(band.left), width: pct(band.width) }} />}
      <span className="mac-player__head" style={{ left: pct(played) }} />
      {hover !== null && Number.isFinite(duration) && duration > 0 && (
        <span className="mac-player__preview" style={{ left: pct((hover / duration) * 100) }} aria-hidden="true">
          <span className="mac-player__preview-frame">
            {hoverSegment?.thumb_url != null && <img src={hoverSegment.thumb_url} alt="" />}
          </span>
          <span className="mac-player__preview-line">{hoverLine(hover, detail.segments, detail.turns)}</span>
        </span>
      )}
    </div>
  );
}

/**
 * Find this (a toggle), Cut out and the cost line, at the end of the control row (board V18).
 * @param props - Pick mode, whether there is a video, and what to do first (pause).
 * @returns The buttons.
 */
function PickButtons({ pick, isDisabled, onStart }: { pick: ObjectPick; isDisabled: boolean; onStart: () => void }) {
  const purpose = purposeOf(pick.state);
  const press = (which: PickPurpose) => {
    if (purpose !== which) onStart();
    pick.toggle(which);
  };
  return (
    <span className="mac-player__pick">
      <button
        type="button"
        className={purpose === 'find' ? 'mac-button mac-player__find mac-player__find--on' : 'mac-button mac-player__find'}
        aria-pressed={purpose === 'find'}
        disabled={isDisabled}
        onClick={() => {
          press('find');
        }}
      >
        <Icon name="target" size="xs" />
        {FIND_COPY.findThis}
      </button>
      <button
        type="button"
        className={purpose === 'cutout' ? 'mac-button mac-player__find mac-player__find--on' : 'mac-button mac-player__find'}
        aria-pressed={purpose === 'cutout'}
        disabled={isDisabled}
        onClick={() => {
          press('cutout');
        }}
      >
        {FIND_COPY.cutOut}
      </button>
      <span className="mac-player__total mac-player__pick-cost">{FIND_COPY.cost}</span>
    </span>
  );
}

/** Toggle buttons look on when pressed: captions and loop. */
const toggleClass = (isOn: boolean) => (isOn ? 'mac-player__button mac-player__button--on' : 'mac-player__button');

/**
 * The player.
 * @param props - See `MacPlayerProps`.
 * @returns The player block.
 */
export function MacPlayer({ detail, src, poster, video, pick }: MacPlayerProps) {
  const navigate = useNavigate();
  const { ref, currentTime, onTimeUpdate, onLoadedMetadata } = video;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [duration, setDuration] = useState(detail.clip.duration_s ?? Number.NaN);
  const [speed, setSpeed] = useState(1);
  const [shuttle, setShuttle] = useState(0);
  const [volume, setVolume] = useState(START_VOLUME);
  const [hasCaptions, setCaptions] = useState(true);
  const [isLooping, setLooping] = useState(false);
  const [range, setRange] = useState<Range>({ inS: null, outS: null });
  const [cachedPercent, setCachedPercent] = useState(0);
  const { segments, turns } = detail;
  const span = rangeSpan(range);
  const hasRange = span !== null;
  const handoff = span === null ? null : handoffFromRange(detail, span);
  const moment = momentCaption(segments, currentTime);
  const caption = turns[activeIndex(turns, currentTime)]?.text ?? null;
  const canPip = typeof document !== 'undefined' && document.pictureInPictureEnabled;
  const canFullscreen = typeof document !== 'undefined' && document.fullscreenEnabled;

  // The keys work while the player has focus; it takes focus when the page opens.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      const element = ref.current;
      if (element === null) return;
      element.currentTime = clampSeek(seconds, element.duration);
      onTimeUpdate();
    },
    [ref, onTimeUpdate],
  );

  const togglePlay = useCallback(() => {
    const element = ref.current;
    if (element === null) return;
    setShuttle(0);
    if (element.paused) {
      element.play().catch(() => {
        // Recovers: playback can be refused; the button stays on Play.
      });
    } else {
      element.pause();
    }
  }, [ref]);

  // The shuttle: forward sets the rate and plays; backward steps back on a timer; K stops.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return undefined;
    if (shuttle > 0) {
      element.playbackRate = shuttle;
      element.play().catch(() => {
        // Recovers: playback can be refused; the shuttle then does nothing.
      });
      return undefined;
    }
    element.playbackRate = speed;
    if (shuttle === 0) return undefined;
    element.pause();
    const timer = setInterval(() => {
      element.currentTime = Math.max(0, element.currentTime + (shuttle * REVERSE_STEP_MS) / 1000);
      onTimeUpdate();
    }, REVERSE_STEP_MS);
    return () => {
      clearInterval(timer);
    };
  }, [ref, shuttle, speed, onTimeUpdate]);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.volume = volume / 100;
    element.muted = volume === 0;
  }, [ref, volume, src]);

  // Loop: the in–out range when one is set, else the whole clip.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.loop = isLooping && !hasRange;
  }, [ref, isLooping, hasRange]);
  const loopStart = isLooping && span !== null && currentTime >= span.end_s && isPlaying ? span.start_s : null;
  useEffect(() => {
    if (loopStart !== null) seekTo(loopStart);
  }, [loopStart, seekTo]);

  const run = (action: PlayerAction) => {
    switch (action.kind) {
      case 'toggle-play':
        togglePlay();
        return;
      case 'shuttle':
        setShuttle((rate) => nextShuttle(rate, action.key));
        return;
      case 'nudge':
        seekTo(currentTime + action.seconds);
        return;
      case 'frame':
        setShuttle(0);
        ref.current?.pause();
        seekTo(currentTime + action.frames * FRAME_S);
        return;
      case 'mark-in':
        setRange((r) => markIn(r, currentTime));
        return;
      case 'mark-out':
        setRange((r) => markOut(r, currentTime));
        return;
      case 'captions':
        setCaptions((on) => !on);
        return;
      case 'next-moment': {
        const next = nextMomentStart(segments, currentTime);
        if (next !== null) seekTo(next);
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    // A text field keeps its keys; the volume slider keeps only its arrows.
    if (target.closest('input:not([type="range"]), select, textarea') !== null) return;
    if (target instanceof HTMLInputElement && event.key.startsWith('Arrow')) return;
    const action = playerKeyAction(event);
    if (action === null) return;
    event.preventDefault();
    run(action);
  };

  const previous = previousMomentStart(segments, currentTime);
  const next = nextMomentStart(segments, currentTime);

  return (
    <div className="mac-player" ref={rootRef} tabIndex={0} aria-label="Clip player" onKeyDown={onKeyDown}>
      <div className="mac-player__stage">
        {src === null ? (
          <div className="mac-player__pending" role="status">
            {detail.clip.status === 'duplicate' ? (
              'No preview: this is a copy'
            ) : (
              <>
                <Spinner />
                Preparing the preview…
              </>
            )}
          </div>
        ) : (
          <video
            ref={ref}
            className="mac-player__video"
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
            onTimeUpdate={(event) => {
              onTimeUpdate();
              setCachedPercent(bufferedPercent(bufferedRanges(event.currentTarget), event.currentTarget.currentTime, event.currentTarget.duration));
            }}
            onProgress={(event) => {
              setCachedPercent(bufferedPercent(bufferedRanges(event.currentTarget), event.currentTarget.currentTime, event.currentTarget.duration));
            }}
            onLoadedMetadata={onLoadedMetadata}
          />
        )}
        {hasCaptions && caption !== null && <span className="mac-player__caption">{caption}</span>}
        {pick !== undefined && src !== null && (
          <PickOverlay state={pick.state} videoRef={ref} fit="contain" onPick={pick.pick} onRetry={pick.retry} onCancel={pick.cancel} />
        )}
      </div>

      <div className="mac-player__bar">
        <Scrubber
          detail={detail}
          duration={duration}
          currentTime={currentTime}
          cachedPercent={cachedPercent}
          onSeek={seekTo}
          inView={pick?.state.phase === 'found' ? pick.state.found.in_view : null}
        />

        <div className="mac-player__controls">
          <button type="button" className="mac-player__play" aria-label={isPlaying ? 'Pause' : 'Play'} onClick={togglePlay}>
            <Icon name={isPlaying ? 'pause' : 'play'} size="xs" />
          </button>
          <button type="button" className="mac-player__button mac-player__button--bright" aria-label="Back 10 seconds" onClick={() => { seekTo(currentTime - JUMP_S); }}>
            <PlayerGlyph name="back10" size="md" />
          </button>
          <button type="button" className="mac-player__button mac-player__button--bright" aria-label="Forward 10 seconds" onClick={() => { seekTo(currentTime + JUMP_S); }}>
            <PlayerGlyph name="forward10" size="md" />
          </button>
          <button type="button" className="mac-player__button" aria-label="Previous frame" onClick={() => { run({ kind: 'frame', frames: -1 }); }}>
            <PlayerGlyph name="frame-back" />
          </button>
          <button type="button" className="mac-player__button" aria-label="Next frame" onClick={() => { run({ kind: 'frame', frames: 1 }); }}>
            <PlayerGlyph name="frame-forward" />
          </button>
          <span className="mac-player__time">
            {formatDuration(currentTime)} <span className="mac-player__total">{`/ ${Number.isFinite(duration) ? formatDuration(duration) : '–:––'}`}</span>
          </span>

          <span className="mac-player__moment">
            <button type="button" className="mac-player__button mac-player__button--sm" aria-label="Previous moment" disabled={previous === null} onClick={() => { if (previous !== null) seekTo(previous); }}>
              <Icon name="back" size="xs" />
            </button>
            <span className="mac-player__moment-text">
              {moment === null ? (
                <span className="mac-player__total">{segments.length === 0 ? 'No moments yet' : 'Between moments'}</span>
              ) : (
                <>
                  <b>{moment.label}</b>
                  {moment.text === '' ? '' : ` · ${moment.text}`}
                </>
              )}
            </span>
            <button type="button" className="mac-player__button mac-player__button--sm" aria-label="Next moment" disabled={next === null} onClick={() => { if (next !== null) seekTo(next); }}>
              <Icon name="chevron-right" size="xs" />
            </button>
          </span>

          <button type="button" className="mac-player__speed" aria-label="Playback speed" onClick={() => { setSpeed(nextSpeed(speed)); }}>
            {speedLabel(speed)}
          </button>
          <span className="mac-player__volume">
            <PlayerGlyph name={volume === 0 ? 'muted' : 'volume'} />
            <input type="range" min={0} max={100} value={volume} aria-label="Volume" onChange={(event) => { setVolume(Number(event.target.value)); }} />
          </span>
          <button type="button" className={toggleClass(hasCaptions)} aria-label="Captions" aria-pressed={hasCaptions} onClick={() => { setCaptions(!hasCaptions); }}>
            <PlayerGlyph name="captions" size="md" />
          </button>
          <button type="button" className={toggleClass(isLooping)} aria-label="Loop" aria-pressed={isLooping} onClick={() => { setLooping(!isLooping); }}>
            <PlayerGlyph name="loop" />
          </button>
          <button
            type="button"
            className="mac-player__button"
            aria-label="Picture in picture"
            disabled={!canPip || src === null}
            onClick={() => {
              ref.current?.requestPictureInPicture().catch(() => {
                // Recovers: the window may refuse; the player keeps playing inline.
              });
            }}
          >
            <PlayerGlyph name="pip" />
          </button>
          <button
            type="button"
            className="mac-player__button"
            aria-label="Full screen"
            disabled={!canFullscreen}
            onClick={() => {
              rootRef.current?.requestFullscreen().catch(() => {
                // Recovers: full screen can be refused; nothing changes.
              });
            }}
          >
            <PlayerGlyph name="fullscreen" />
          </button>
          {pick !== undefined && <PickButtons pick={pick} isDisabled={src === null} onStart={() => ref.current?.pause()} />}
        </div>

        <div className="mac-player__range">
          <span className="mac-player__label">
            In <span className="mac-player__mark">{range.inS === null ? '–:––' : formatDuration(range.inS)}</span>
          </span>
          <span className="mac-player__label">
            Out <span className="mac-player__mark">{range.outS === null ? '–:––' : formatDuration(range.outS)}</span>
          </span>
          <span className="mac-player__total">{rangeLine(range)}</span>
          <button
            type="button"
            className="mac-player__make"
            disabled={handoff === null || handoff.segmentIds.length === 0}
            onClick={() => {
              if (handoff !== null) void navigate('/editor', { state: handoff });
            }}
          >
            Make a short from this range
          </button>
          <span className="mac-player__spacer" />
          <span className="mac-player__keys">Space play · J K L shuttle · ← → 5 s · , . frame · I O in/out · C captions</span>
        </div>
      </div>
    </div>
  );
}
