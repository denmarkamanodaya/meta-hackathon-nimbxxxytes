// A feature film from real Mac captures, full frame (shared by NimbytesFeatureIGuide and
// NimbytesFeatureIRead). Cuts of a capture play in order, each framed tight on what matters while
// the camera moves (a slow pan and push with a slight 3D tilt that settles); cuts dissolve into each
// other. Over them, the promo's dialogue: the feature's name small, a two-tone headline top left on
// a dark corner scrim, and a label under it naming what is running. Voice-over lines play at their
// places.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { ROBOTO } from '../fonts';
import { During } from '../promo/parts';
import { COLOR, NIGHT } from '../theme';
import { Headline } from './Headline';
import { useEnter } from './motion';
import { Pill } from './Pill';
import type { VoLine } from './voTiming';

export const FILM_FPS = 30;
/** Frames each cut dissolves in over the one before it. */
const DISSOLVE = 10;
/** Frames held on the last cut after it ends. */
const HOLD = 15;

/** A camera framing: the capture point at the frame's centre (0–1 from top left), the zoom and a 3D tilt (degrees). */
export interface Frame {
  x: number;
  y: number;
  zoom: number;
  tiltX?: number;
  tiltY?: number;
}

/** A label naming what is running; `next` switches to new text `atS` seconds into the cut, `then` to more after it. */
export interface Label {
  text: string;
  /** Yellow for Meta AI agents at work, teal otherwise. */
  agents?: boolean;
  next?: { atS: number; text: string };
  then?: readonly { atS: number; text: string }[];
}

/** A camera keyframe inside a cut: a framing reached `atS` seconds into the cut. */
export type Key = Frame & { atS: number };

/** One piece of a capture: where it starts and ends (seconds in the file), the framing it starts on and moves to, and its label. */
export interface Cut {
  clip: string;
  fromS: number;
  toS: number;
  start: Frame;
  end: Frame;
  /** The pill naming what is running; leave it out for no pill. */
  label?: Label;
  /** Play the capture's sound (the app reading aloud). */
  audio?: boolean;
  /** Stop the sound here (seconds in the file), before the cut ends. */
  audioUntilS?: number;
  /** Let the framing go past the capture's edges (the app's own dark background shows there). */
  free?: boolean;
  /** A camera path for a long uncut shot: eases from keyframe to keyframe (replaces start → end). */
  keys?: readonly Key[];
}

/** A two-tone headline and the frame it comes in on (it stays until the next one). */
export interface Head {
  first: string;
  second: string;
  from: number;
}

type Placed = Cut & { from: number; frames: number };

/** Lays cuts back to back, each overlapping the last by DISSOLVE. */
function place(cuts: readonly Cut[]): Placed[] {
  return cuts.reduce<{ at: number; list: Placed[] }>(
    (acc, cut) => {
      const frames = Math.round((cut.toS - cut.fromS) * FILM_FPS);
      const from = acc.list.length === 0 ? 0 : acc.at - DISSOLVE;
      return { at: from + frames, list: [...acc.list, { ...cut, from, frames }] };
    },
    { at: 0, list: [] },
  ).list;
}

/**
 * A film's length in frames: its cuts back to back plus a short hold.
 * @param cuts - The cuts.
 * @returns Frames.
 */
export function filmFrames(cuts: readonly Cut[]): number {
  const last = place(cuts).at(-1);
  return (last?.from ?? 0) + (last?.frames ?? 0) + HOLD;
}

/** The app's own dark background, behind the captures while one dissolves in or tilts. */
const APP_BG = '#141414';
/** The frame is the whole canvas; captures (3840 × 2325) cover it at zoom 1, full width. */
const W = 1920;
const H = 1080;
const CAPTURE_H = Math.round((W * 2325) / 3840);
/** Extra scale while tilted, so the tilted edges never come into view. */
const TILT_COVER = 1.08;

/** Places the capture for a framing, never letting an edge show inside the frame (unless `free`). */
function placement({ x, y, zoom }: Frame, free = false) {
  const w = W * zoom;
  const h = CAPTURE_H * zoom;
  const left = free ? W / 2 - x * w : Math.min(0, Math.max(W - w, W / 2 - x * w));
  const top = free ? H / 2 - y * h : Math.min(0, Math.max(H - h, H / 2 - y * h));
  return { position: 'absolute', left, top, width: w, height: h } as const;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The two framings the camera is between at `frame`, and how far (eased): start → end, or along `keys`. */
function segment(cut: Placed, frame: number): { a: Frame; b: Frame; t: number } {
  const ease = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) } as const;
  const keys = cut.keys;
  if (keys === undefined || keys.length === 0) return { a: cut.start, b: cut.end, t: interpolate(frame, [0, cut.frames], [0, 1], ease) };
  const at = (key: Key) => Math.round(key.atS * FILM_FPS);
  const first: Key = keys[0] ?? { ...cut.start, atS: 0 };
  const next = keys.findIndex((key) => at(key) > frame);
  if (next <= 0) return next === 0 ? { a: first, b: first, t: 0 } : { a: keys.at(-1) ?? first, b: keys.at(-1) ?? first, t: 0 };
  const a = keys[next - 1] ?? first;
  const b = keys[next] ?? a;
  return { a, b, t: interpolate(frame, [at(a), at(b)], [0, 1], ease) };
}

function CutView({ cut, isFirst }: { cut: Placed; isFirst: boolean }) {
  const frame = useCurrentFrame();
  const { a, b, t } = segment(cut, frame);
  const cam = { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), zoom: mix(a.zoom, b.zoom, t) };
  const tiltX = mix(a.tiltX ?? 0, b.tiltX ?? 0, t);
  const tiltY = mix(a.tiltY ?? 0, b.tiltY ?? 0, t);
  const opacity = isFirst ? 1 : interpolate(frame, [0, DISSOLVE], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  const place = placement(cam, cut.free === true);
  const soundFrames = cut.audioUntilS === undefined ? cut.frames : Math.round((cut.audioUntilS - cut.fromS) * FILM_FPS);
  // The tilt's extra scale grows from the edge the camera sits against (the app's bottom bar, its
  // top), so that edge's content stays in frame; otherwise from the centre.
  const originY = place.top <= H - place.height ? 'bottom' : place.top >= 0 ? 'top' : 'center';
  const originX = place.left <= W - place.width ? 'right' : place.left >= 0 ? 'left' : 'center';
  return (
    <AbsoluteFill style={{ opacity, transformOrigin: `${originX} ${originY}`, transform: `perspective(2200px) rotateX(${String(tiltX)}deg) rotateY(${String(tiltY)}deg) scale(${String(TILT_COVER)})` }}>
      {/* The capture's sound stops at the cut's end (or `audioUntilS`), so a hold stays quiet. */}
      <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * FILM_FPS)} muted={cut.audio !== true} volume={(f) => (f < soundFrames ? 1 : 0)} style={place} />
    </AbsoluteFill>
  );
}

/** Where the promo puts the headline and the label under it. */
const HEAD = { position: 'absolute', left: 96, top: 104 } as const;
const UNDER = { position: 'absolute', left: 96, top: 270 } as const;

/** The label for one cut, switching to its `next` (and `then`) texts part way in. */
function CutLabel({ cut, isLast }: { cut: Placed; isLast: boolean }) {
  const label = cut.label;
  if (label === undefined) return null;
  const background = label.agents === true ? COLOR.yellow : NIGHT.accent;
  const steps = [{ atS: 0, text: label.text }, ...(label.next === undefined ? [] : [label.next]), ...(label.then ?? [])];
  const end = cut.from + cut.frames + (isLast || label.next !== undefined ? HOLD : 0);
  return (
    <>
      {steps.map((step, index) => (
        <During key={step.text} from={cut.from + Math.round(step.atS * FILM_FPS)} to={index < steps.length - 1 ? cut.from + Math.round((steps[index + 1]?.atS ?? 0) * FILM_FPS) : end}>
          <div style={UNDER}>
            <Pill background={background} color={NIGHT.bgDeep}>{step.text}</Pill>
          </div>
        </During>
      ))}
    </>
  );
}

/**
 * The film.
 * @param name - The feature's name, small, top left.
 * @param cuts - The capture cuts in order.
 * @param heads - The headlines in order.
 * @param vo - Voice-over lines (frames from the start).
 * @param voDir - Folder under public/ holding `<line id>.wav`.
 * @param note - Optional small note, bottom right, for the whole film (a source credit).
 * @param scrim - The dark top-left corner under the headline and labels (default on).
 */
export function CaptureFilm({ name, cuts, heads, vo, voDir, note, scrim = true }: { name: string; cuts: readonly Cut[]; heads: readonly Head[]; vo: readonly VoLine[]; voDir: string; note?: string; scrim?: boolean }) {
  const placed = place(cuts);
  return (
    <AbsoluteFill style={{ background: APP_BG, overflow: 'hidden' }}>
      {placed.map((cut, index) => (
        <Sequence key={`${cut.clip}-${String(cut.fromS)}`} from={cut.from} durationInFrames={cut.frames + (index === placed.length - 1 ? HOLD : DISSOLVE)}>
          <CutView cut={cut} isFirst={index === 0} />
        </Sequence>
      ))}
      {/* The promo's corner scrim: the headline and labels read on any frame. */}
      {scrim && <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 0% 0%, rgba(5,8,10,0.97) 0%, rgba(5,8,10,0.82) 45%, transparent 100%)' }} />}
      <div style={{ position: 'absolute', left: 98, top: 48, fontFamily: ROBOTO, fontWeight: 300, fontSize: 34, letterSpacing: 1, color: COLOR.white, opacity: useEnter(2) }}>{name}</div>
      {heads.map((head, index) => (
        <During key={head.first} from={head.from} {...(index < heads.length - 1 ? { to: (heads[index + 1]?.from ?? head.from) + 6 } : {})}>
          <div style={HEAD}>
            <Headline first={head.first} second={head.second} size={64} delay={head.from} />
          </div>
        </During>
      ))}
      {placed.map((cut, index) => (
        <CutLabel key={`label-${String(cut.from)}`} cut={cut} isLast={index === placed.length - 1} />
      ))}
      {note !== undefined && (
        <>
          {/* A soft dark corner under the note, so it reads over the app's bottom bar. */}
          <div style={{ position: 'absolute', right: 0, bottom: 0, width: 1100, height: 220, background: 'radial-gradient(ellipse at 100% 100%, rgba(5,8,10,0.85) 0%, rgba(5,8,10,0.55) 40%, transparent 75%)' }} />
          <div style={{ position: 'absolute', right: 48, bottom: 36, maxWidth: 900, textAlign: 'right', fontFamily: ROBOTO, fontWeight: 300, fontSize: 22, lineHeight: 1.4, color: COLOR.white, textShadow: '0 1px 8px rgba(0,0,0,0.8)', opacity: useEnter(6) }}>{note}</div>
        </>
      )}
      {vo.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`${voDir}/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
