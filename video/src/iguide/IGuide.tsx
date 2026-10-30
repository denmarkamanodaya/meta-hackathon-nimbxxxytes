// NimbytesFeatureIGuide: the iGuide feature from real Mac captures, full frame. The cuts play in
// order: a clip attached and the request typed, Muse Spark's plan, Make iGuide and the agents
// running to Ready, then the finished guide reading step 1 aloud (the app's own device voice,
// captured with the screen). Each cut is framed tight on what matters and the camera moves while it
// plays (a slow pan and push with a slight 3D tilt that settles); cuts dissolve into each other.
// Over them, the promo's iGuide dialogue: a two-tone headline top left on a dark corner scrim and a
// label under it naming what is running (Muse Spark, the agents, SAM 3.1, read aloud). Captures:
// public/live/iguide-*.mp4. The voice-over (src/iguide/vo-lines.json) sets the length: the cuts
// are trimmed to its lines.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Headline } from '../components/Headline';
import { useEnter } from '../components/motion';
import { Pill } from '../components/Pill';
import { placeLines } from '../components/voTiming';
import { ROBOTO } from '../fonts';
import { During } from '../promo/parts';
import { COLOR, NIGHT } from '../theme';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const FPS = 30;
/** Frames each cut dissolves in over the one before it. */
const DISSOLVE = 10;

/** A camera framing: the capture point at the frame's centre (0–1 from top left), the zoom and a 3D tilt (degrees). */
interface Frame {
  x: number;
  y: number;
  zoom: number;
  tiltX?: number;
  tiltY?: number;
}

/** A label naming what is running; `atS` is seconds into the cut it switches to `next`. */
interface Label {
  text: string;
  /** Yellow for the agents at work, teal otherwise. */
  agents?: boolean;
  next?: { atS: number; text: string };
}

/** One piece of a capture: where it starts and ends (seconds in the file), the framing it starts on and the one it moves to, and its label. */
interface Cut {
  clip: string;
  fromS: number;
  toS: number;
  start: Frame;
  end: Frame;
  label: Label;
  /** Play the capture's sound (the read-aloud). */
  audio?: boolean;
}

/** The app's own dark background, behind the captures while one dissolves in or tilts. */
const APP_BG = '#141414';

const MAKING = 'live/iguide-making.mp4';
const READ = 'live/iguide-read-aloud.mp4';

/**
 * The cuts in order (times measured on the captures), trimmed to the voice-over: line 1 (7.2 s,
 * from 0.3 s) runs over attaching and typing; line 2 (5.5 s, from 7.9 s) over the plan, the agents
 * and Ready; a short beat later the guide reads step 1 aloud. Each cut overlaps the last by
 * DISSOLVE, so the cut lengths here are what land each join on its line. Re-speaking a line means
 * re-trimming. Framings are tight on the part that matters (fractions of the capture), with the
 * subject right of centre and low, clear of the headline top left.
 */
const CUTS: readonly Cut[] = [
  // The Add clips dialog: "Seasoning chicken breasts" ticked.
  { clip: MAKING, fromS: 4.6, toS: 7.6, start: { x: 0.43, y: 0.36, zoom: 1.9, tiltY: -7, tiltX: 4 }, end: { x: 0.44, y: 0.35, zoom: 2.1, tiltY: -2, tiltX: 1 }, label: { text: 'Attach a clip' } },
  // The request typed into iRecall.
  { clip: MAKING, fromS: 7.6, toS: 12.8, start: { x: 0.36, y: 0.95, zoom: 2.5, tiltY: 6, tiltX: -3 }, end: { x: 0.46, y: 0.95, zoom: 2.6, tiltY: 1, tiltX: 0 }, label: { text: 'Ask in plain words' } },
  // Sent: Muse Spark plans the guide (4 steps and the models that run them).
  { clip: MAKING, fromS: 26.4, toS: 28.6, start: { x: 0.4, y: 0.62, zoom: 2.1, tiltY: -6, tiltX: 3 }, end: { x: 0.42, y: 0.63, zoom: 2.3, tiltY: -1 }, label: { text: 'Planned by Muse Spark' } },
  // Make iGuide: the agents start, step 1 of 4.
  { clip: MAKING, fromS: 41.0, toS: 43.0, start: { x: 0.38, y: 0.64, zoom: 2.4, tiltY: 6, tiltX: 2 }, end: { x: 0.41, y: 0.63, zoom: 2.6, tiltY: 1 }, label: { text: 'Meta AI agents at work', agents: true } },
  // Ready: all 4 steps done.
  { clip: MAKING, fromS: 90.6, toS: 92.5, start: { x: 0.4, y: 0.62, zoom: 2.2, tiltY: -5, tiltX: -2 }, end: { x: 0.41, y: 0.63, zoom: 2.35 }, label: { text: 'Steps · frames · SAM 3.1 · voice', agents: true } },
  // The guide: step 1 with SAM's outline, then read aloud (the app's own voice).
  { clip: READ, fromS: 2.4, toS: 7.4, start: { x: 0.34, y: 0.26, zoom: 1.7, tiltY: 6, tiltX: 3 }, end: { x: 0.4, y: 0.29, zoom: 2.0, tiltY: 0 }, label: { text: 'SAM 3.1 outlines the step', next: { atS: 1.1, text: 'Reading it aloud' } }, audio: true },
];

type Placed = Cut & { from: number; frames: number };

/** Where each cut starts on the composition, in frames (each overlaps the last by DISSOLVE). */
const PLACED: readonly Placed[] = CUTS.reduce<{ at: number; list: Placed[] }>(
  (acc, cut) => {
    const frames = Math.round((cut.toS - cut.fromS) * FPS);
    const from = acc.list.length === 0 ? 0 : acc.at - DISSOLVE;
    return { at: from + frames, list: [...acc.list, { ...cut, from, frames }] };
  },
  { at: 0, list: [] },
).list;

/** The voice-over (British female, normal speed): two lines, timed as the cuts above. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.4, tail: 0 }).lines;

/** The composition's length in frames, with a short hold on the last cut. */
export const IGUIDE_FRAMES = (PLACED.at(-1)?.from ?? 0) + (PLACED.at(-1)?.frames ?? 0) + 15;

/** The frame is the whole canvas; the capture (3840 × 2325) covers it at zoom 1, full width. */
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
  return (
    <AbsoluteFill style={{ opacity, transform: `perspective(2200px) rotateX(${String(tiltX)}deg) rotateY(${String(tiltY)}deg) scale(${String(TILT_COVER)})` }}>
      <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * FPS)} muted={cut.audio !== true} style={placement(cam)} />
    </AbsoluteFill>
  );
}

/** Where the promo puts the headline and the label under it. */
const HEAD = { position: 'absolute', left: 96, top: 104 } as const;
const UNDER = { position: 'absolute', left: 96, top: 270 } as const;

/** The feature's name, small, above the headline. */
function Eyebrow() {
  return <div style={{ position: 'absolute', left: 98, top: 48, fontFamily: ROBOTO, fontWeight: 300, fontSize: 34, letterSpacing: 1, color: COLOR.white, opacity: useEnter(2) }}>iGuide</div>;
}

/** The label for one cut, switching to its `next` text part way in. */
function CutLabel({ cut }: { cut: Placed }) {
  const switchAt = cut.label.next === undefined ? undefined : cut.from + Math.round(cut.label.next.atS * FPS);
  const background = cut.label.agents === true ? COLOR.yellow : NIGHT.accent;
  const pill = (text: string) => (
    <div style={UNDER}>
      <Pill background={background} color={NIGHT.bgDeep}>{text}</Pill>
    </div>
  );
  return (
    <>
      <During from={cut.from} to={switchAt ?? cut.from + cut.frames}>{pill(cut.label.text)}</During>
      {cut.label.next !== undefined && switchAt !== undefined && <During from={switchAt} to={cut.from + cut.frames + 15}>{pill(cut.label.next.text)}</During>}
    </>
  );
}

export function IGuide() {
  const second = VO[1]?.from ?? 0;
  return (
    <AbsoluteFill style={{ background: APP_BG, overflow: 'hidden' }}>
      {PLACED.map((cut, index) => (
        <Sequence key={`${cut.clip}-${String(cut.fromS)}`} from={cut.from} durationInFrames={cut.frames + (index === PLACED.length - 1 ? 15 : DISSOLVE)}>
          <CutView cut={cut} isFirst={index === 0} />
        </Sequence>
      ))}
      {/* The promo's corner scrim: the headline and labels read on any frame. */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 60% at 0% 0%, rgba(5,8,10,0.97) 0%, rgba(5,8,10,0.82) 45%, transparent 100%)' }} />
      <Eyebrow />
      <During from={0} to={second + 6}>
        <div style={HEAD}>
          <Headline first="Turn any video into" second="clear, step-by-step instructions." size={64} />
        </div>
      </During>
      <During from={second}>
        <div style={HEAD}>
          <Headline first="A step-by-step workflow" second="to complete, read aloud." size={64} delay={second} />
        </div>
      </During>
      {PLACED.map((cut) => (
        <CutLabel key={`label-${String(cut.from)}`} cut={cut} />
      ))}
      {VO.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/iguide-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
