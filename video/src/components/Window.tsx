// A Mac app window holding a real capture (a still from public/shots or a clip from public/live),
// with a 3D swing-in and a gentle float, a camera that eases between focus points, and rings pinned to spots on the
// capture, so they move with the camera. Spots are fractions of the capture (0–1 from top left).
import type { CSSProperties, ReactNode } from 'react';
import { Img, interpolate, OffthreadVideo, Easing, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { INTER } from '../fonts';
import { NIGHT } from '../theme';
import { hasAsset } from './assets';
import { useEnter } from './motion';

/** A camera position: the capture point at the window's centre, and the zoom. */
export interface Cam {
  at: number;
  x: number;
  y: number;
  zoom: number;
}

const ease = Easing.bezier(0.65, 0, 0.35, 1);

/** Frames two cuts overlap: the next one dissolves in over the last, calmly. */
const DISSOLVE = 12;

/**
 * The camera at a frame, eased between keyframes.
 * @param frame - Scene frame.
 * @param keys - Keyframes in time order.
 * @returns The position.
 */
export function cameraAt(frame: number, keys: readonly Cam[]): Omit<Cam, 'at'> {
  const first = keys[0] ?? { at: 0, x: 0.5, y: 0.5, zoom: 1 };
  if (keys.length < 2 || frame <= first.at) return first;
  for (let i = 1; i < keys.length; i += 1) {
    const a = keys[i - 1] ?? first;
    const b = keys[i] ?? first;
    if (frame <= b.at) {
      const t = interpolate(frame, [a.at, b.at], [0, 1], { easing: ease });
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, zoom: a.zoom + (b.zoom - a.zoom) * t };
    }
  }
  return keys.at(-1) ?? first;
}

/** A rectangle on the capture, in fractions. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A glowing ring that draws itself around a spot: its stroke runs around the target, the glow
 * swells, and the label slides out from the corner. It un-draws on exit instead of fading.
 */
export function Ring({ spot, from, to, label, color = NIGHT.accent, zoom }: { spot: Spot; from: number; to?: number; label?: string; color?: string; zoom: number }) {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [from, from + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const undraw = to === undefined ? 1 : interpolate(frame, [to - 10, to], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const shown = Math.min(draw, undraw);
  if (shown <= 0) return null;
  const glow = 0.55 + 0.45 * Math.sin((frame - from) / 9);
  const labelIn = interpolate(frame, [from + 8, from + 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.back(1.4)) });
  const stroke = 4 / zoom;
  return (
    <div style={{ position: 'absolute', left: `${String(spot.x * 100)}%`, top: `${String(spot.y * 100)}%`, width: `${String(spot.w * 100)}%`, height: `${String(spot.h * 100)}%` }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible', filter: `drop-shadow(0 0 ${String((10 + 14 * glow) / zoom)}px ${color})` }}>
        <rect x="0" y="0" width="100%" height="100%" rx={12 / zoom} fill="none" stroke={color} strokeWidth={stroke} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - shown} />
      </svg>
      {label !== undefined && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '100%',
            marginTop: 10 / zoom,
            transform: `scale(${String(1 / zoom)}) translateX(${String((1 - labelIn * undraw) * -40)}px)`,
            transformOrigin: 'top left',
            opacity: labelIn * undraw,
            background: color,
            color: NIGHT.bgDeep,
            fontFamily: INTER,
            fontWeight: 400,
            fontSize: 30,
            padding: '6px 16px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

/** What a window shows: a still, a clip from a start second (sped up by `rate`), or a labelled empty slot. */
export type Capture = { still: string } | { clip: string; fromS?: number; rate?: number } | { cuts: readonly PlacedCut[] } | { missing: string };

/** A piece of a real-speed recording (or a still, when `clip` is a .png): where it starts in the clip and how long it plays (seconds). */
export interface Cut {
  clip: string;
  fromS: number;
  durS: number;
}

/** A cut placed in a scene: its start and length in scene frames. */
export interface PlacedCut extends Cut {
  from: number;
  frames: number;
}

/**
 * Lays real-speed cuts back to back from `start`, trimming each one's tail evenly so together they
 * fill `frames` exactly (or extending the last one when they are short). Never speeds anything up.
 * @param cuts - The cuts in order.
 * @param start - Scene frame the first cut starts.
 * @param frames - Frames to fill.
 * @returns The placed cuts.
 */
export function layCuts(cuts: readonly Cut[], start: number, frames: number): PlacedCut[] {
  const total = cuts.reduce((sum, cut) => sum + cut.durS * 30, 0);
  const scale = Math.min(1, frames / total);
  let at = start;
  return cuts.map((cut, index) => {
    const isLast = index === cuts.length - 1;
    const length = isLast ? start + frames - at : Math.round(cut.durS * 30 * scale);
    const placed = { ...cut, from: at, frames: Math.max(1, length) };
    at += placed.frames;
    return placed;
  });
}

/** A cut fading in over the one before it (the first shows at once). */
function Dissolve({ isFirst, children }: { isFirst: boolean; children: ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = isFirst ? 1 : interpolate(frame, [0, DISSOLVE], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  return <div style={{ position: 'absolute', inset: 0, opacity }}>{children}</div>;
}

function CaptureLayer({ capture }: { capture: Capture }) {
  const fill: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
  if ('still' in capture) return hasAsset(capture.still) ? <Img src={staticFile(capture.still)} style={fill} /> : <Missing what={capture.still} />;
  if ('cuts' in capture) {
    return (
      <>
        {capture.cuts.map((cut, index) => (
          <Sequence key={`${cut.clip}-${String(cut.from)}`} from={cut.from} durationInFrames={cut.frames + (index < capture.cuts.length - 1 ? DISSOLVE : 0)} layout="none">
            <Dissolve isFirst={index === 0}>
              {cut.clip.endsWith('.png') ? <Img src={staticFile(cut.clip)} style={fill} /> : <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * 30)} muted style={fill} />}
            </Dissolve>
          </Sequence>
        ))}
      </>
    );
  }
  if ('clip' in capture) {
    return hasAsset(capture.clip) ? <OffthreadVideo src={staticFile(capture.clip)} trimBefore={Math.round((capture.fromS ?? 0) * 30)} playbackRate={capture.rate ?? 1} muted style={fill} /> : <Missing what={capture.clip} />;
  }
  return <Missing what={capture.missing} />;
}

function Missing({ what }: { what: string }) {
  return (
    <div style={{ width: '100%', height: '100%', background: '#1b2a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: NIGHT.textSoft, fontFamily: INTER, fontWeight: 400, fontSize: 40 }}>
      {`CAPTURE: ${what}`}
    </div>
  );
}

/**
 * The window: title bar, then the capture under the camera, with overlays drawn in capture space.
 * @param props - Placement, capture, camera keyframes, title and overlays (a function of the zoom).
 * @returns The window.
 */
export function Window({
  capture,
  cams = [{ at: 0, x: 0.5, y: 0.5, zoom: 1 }],
  title = 'nimbytes',
  left,
  top,
  width,
  delay = 0,
  overlays,
}: {
  capture: Capture;
  cams?: readonly Cam[];
  title?: string;
  left: number;
  top: number;
  width: number;
  delay?: number;
  overlays?: (zoom: number) => ReactNode;
}) {
  const frame = useCurrentFrame();
  const enter = useEnter(delay);
  const tilt = 1 - enter;
  const float = Math.sin((frame - delay) / 38) * 6;
  const height = (width * 9) / 16;
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        borderRadius: 18,
        overflow: 'hidden',
        background: NIGHT.window,
        border: `1px solid ${NIGHT.glassBorder}`,
        boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 80px ${NIGHT.glowSoft}`,
        opacity: enter,
        transform: `perspective(1800px) translateY(${String(tilt * 140 + float)}px) rotateY(${String(tilt * -22)}deg) rotateX(${String(tilt * 10)}deg) scale(${String(0.9 + 0.1 * enter)})`,
        transformOrigin: 'center left',
      }}
    >
      <div style={{ height: 36, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', background: '#1a1a1a', borderBottom: '1px solid #262626' }}>
        {['#FF5F57', '#FEBC2E', '#28C840'].map((c) => (
          <span key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />
        ))}
        <span style={{ marginLeft: 12, fontFamily: INTER, fontSize: 15, fontWeight: 400, color: '#9aa' }}>{title}</span>
      </div>
      <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>
        <Viewport capture={capture} cams={cams} width={width} height={height} overlays={overlays} />
      </div>
    </div>
  );
}

/** The capture under the camera. */
function Viewport({ capture, cams, width, height, overlays }: { capture: Capture; cams: readonly Cam[]; width: number; height: number; overlays: ((zoom: number) => ReactNode) | undefined }) {
  const frame = useCurrentFrame();
  const fill: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
  /** The capture layer placed under a camera position. */
  const framed = (cam: Omit<Cam, 'at'>, child: ReactNode, extra?: ReactNode) => {
    const half = 0.5 / cam.zoom;
    const cx = Math.min(1 - half, Math.max(half, cam.x));
    const cy = Math.min(1 - half, Math.max(half, cam.y));
    return (
      <div style={{ position: 'absolute', width: width * cam.zoom, height: height * cam.zoom, left: width / 2 - cx * width * cam.zoom, top: height / 2 - cy * height * cam.zoom }}>
        {child}
        {extra}
      </div>
    );
  };
  if (!('cuts' in capture)) {
    const cam = cameraAt(frame, cams);
    return framed(cam, <CaptureLayer capture={capture} />, <div style={{ position: 'absolute', inset: 0 }}>{overlays?.(cam.zoom)}</div>);
  }
  // Each cut keeps its own steady framing while the next dissolves over it: the outgoing cut holds
  // its last framing, the incoming one starts from its first, so the blend never slides.
  const cuts = capture.cuts;
  const live = [...cuts].reverse().find((cut) => frame >= cut.from) ?? cuts[0];
  const liveCam = cameraAt(frame, cams);
  return (
    <>
      {cuts.map((cut, index) => {
        const ends = cut.from + cut.frames;
        const showing = frame >= cut.from && frame < ends + (index < cuts.length - 1 ? DISSOLVE : 0);
        if (!showing) return null;
        // Only this cut's own keys (and earlier ones): the next cut's framing never leaks into it.
        const own = cams.filter((key) => key.at < ends);
        const cam = cameraAt(Math.min(Math.max(frame, cut.from), ends - 1), own.length > 0 ? own : cams);
        const media = cut.clip.endsWith('.png') ? <Img src={staticFile(cut.clip)} style={fill} /> : <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * 30)} muted style={fill} />;
        return (
          <Sequence key={`${cut.clip}-${String(cut.from)}`} from={cut.from} layout="none">
            <Dissolve isFirst={index === 0}>{framed(cam, media)}</Dissolve>
          </Sequence>
        );
      })}
      {live !== undefined && framed(liveCam, null, <div style={{ position: 'absolute', inset: 0 }}>{overlays?.(liveCam.zoom)}</div>)}
    </>
  );
}
