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

/** A label naming what is running; `next` switches to new text `atS` seconds into the cut. */
export interface Label {
  text: string;
  /** Yellow for Meta AI agents at work, teal otherwise. */
  agents?: boolean;
  next?: { atS: number; text: string };
}

/** One piece of a capture: where it starts and ends (seconds in the file), the framing it starts on and moves to, and its label. */
export interface Cut {
  clip: string;
  fromS: number;
  toS: number;
  start: Frame;
  end: Frame;
  label: Label;
  /** Play the capture's sound (the app reading aloud). */
  audio?: boolean;
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

/** Places the capture for a framing, never letting an edge show inside the frame. */
function placement({ x, y, zoom }: Frame) {
  const w = W * zoom;
  const h = CAPTURE_H * zoom;
  const left = Math.min(0, Math.max(W - w, W / 2 - x * w));
  const top = Math.min(0, Math.max(H - h, H / 2 - y * h));
  return { position: 'absolute', left, top, width: w, height: h } as const;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function CutView({ cut, isFirst }: { cut: Placed; isFirst: boolean }) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, cut.frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const cam = { x: mix(cut.start.x, cut.end.x, t), y: mix(cut.start.y, cut.end.y, t), zoom: mix(cut.start.zoom, cut.end.zoom, t) };
  const tiltX = mix(cut.start.tiltX ?? 0, cut.end.tiltX ?? 0, t);
  const tiltY = mix(cut.start.tiltY ?? 0, cut.end.tiltY ?? 0, t);
  const opacity = isFirst ? 1 : interpolate(frame, [0, DISSOLVE], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  const place = placement(cam);
  // The tilt's extra scale grows from the edge the camera sits against (the app's bottom bar, its
  // top), so that edge's content stays in frame; otherwise from the centre.
  const originY = place.top <= H - place.height ? 'bottom' : place.top >= 0 ? 'top' : 'center';
  const originX = place.left <= W - place.width ? 'right' : place.left >= 0 ? 'left' : 'center';
  return (
    <AbsoluteFill style={{ opacity, transformOrigin: `${originX} ${originY}`, transform: `perspective(2200px) rotateX(${String(tiltX)}deg) rotateY(${String(tiltY)}deg) scale(${String(TILT_COVER)})` }}>
      {/* The capture's sound stops at the cut's end, so the hold after the last cut stays quiet. */}
      <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * FILM_FPS)} muted={cut.audio !== true} volume={(f) => (f < cut.frames ? 1 : 0)} style={place} />
    </AbsoluteFill>
  );
}

/** Where the promo puts the headline and the label under it. */
const HEAD = { position: 'absolute', left: 96, top: 104 } as const;
const UNDER = { position: 'absolute', left: 96, top: 270 } as const;

/** The label for one cut, switching to its `next` text part way in. */
function CutLabel({ cut }: { cut: Placed }) {
  const switchAt = cut.label.next === undefined ? undefined : cut.from + Math.round(cut.label.next.atS * FILM_FPS);
  const background = cut.label.agents === true ? COLOR.yellow : NIGHT.accent;
  const pill = (text: string) => (
    <div style={UNDER}>
      <Pill background={background} color={NIGHT.bgDeep}>{text}</Pill>
    </div>
  );
  return (
    <>
      <During from={cut.from} to={switchAt ?? cut.from + cut.frames}>{pill(cut.label.text)}</During>
      {cut.label.next !== undefined && switchAt !== undefined && <During from={switchAt} to={cut.from + cut.frames + HOLD}>{pill(cut.label.next.text)}</During>}
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
 */
export function CaptureFilm({ name, cuts, heads, vo, voDir, note }: { name: string; cuts: readonly Cut[]; heads: readonly Head[]; vo: readonly VoLine[]; voDir: string; note?: string }) {
  const placed = place(cuts);
  return (
    <AbsoluteFill style={{ background: APP_BG, overflow: 'hidden' }}>
      {placed.map((cut, index) => (
        <Sequence key={`${cut.clip}-${String(cut.fromS)}`} from={cut.from} durationInFrames={cut.frames + (index === placed.length - 1 ? HOLD : DISSOLVE)}>
          <CutView cut={cut} isFirst={index === 0} />
        </Sequence>
      ))}
      {/* The promo's corner scrim: the headline and labels read on any frame. */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 0% 0%, rgba(5,8,10,0.97) 0%, rgba(5,8,10,0.82) 45%, transparent 100%)' }} />
      <div style={{ position: 'absolute', left: 98, top: 48, fontFamily: ROBOTO, fontWeight: 300, fontSize: 34, letterSpacing: 1, color: COLOR.white, opacity: useEnter(2) }}>{name}</div>
      {heads.map((head, index) => (
        <During key={head.first} from={head.from} {...(index < heads.length - 1 ? { to: (heads[index + 1]?.from ?? head.from) + 6 } : {})}>
          <div style={HEAD}>
            <Headline first={head.first} second={head.second} size={64} delay={head.from} />
          </div>
        </During>
      ))}
      {placed.map((cut) => (
        <CutLabel key={`label-${String(cut.from)}`} cut={cut} />
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
