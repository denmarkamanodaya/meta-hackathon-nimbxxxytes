// NimbytesFeatureIGuide: the iGuide feature from real Mac captures, full frame (edge to edge, no
// page around them). The cuts play in order: a clip attached and the request typed, Muse Spark's plan,
// Make iGuide and the agents running to Ready, then the finished guide reading step 1 aloud (the
// app's own device voice, captured with the screen). Cuts dissolve into each other and the camera
// eases between framings. Captures: public/live/iguide-*.mp4. The voice-over
// (src/iguide/vo-lines.json) sets the length: the cuts are trimmed to its lines.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { useEnter } from '../components/motion';
import { placeLines } from '../components/voTiming';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const FPS = 30;
/** Frames each cut dissolves in over the one before it. */
const DISSOLVE = 10;

/** A camera framing: the capture point at the frame's centre (0–1 from top left) and the zoom. */
interface Frame {
  x: number;
  y: number;
  zoom: number;
}

/** One piece of a capture: where it starts and ends (seconds in the file), the framing it starts on and the one it eases to. */
interface Cut {
  clip: string;
  fromS: number;
  toS: number;
  start: Frame;
  end: Frame;
  /** Play the capture's sound (the read-aloud). */
  audio?: boolean;
}

/** The app's own dark background, behind the captures while one dissolves in. */
const APP_BG = '#141414';

const MAKING = 'live/iguide-making.mp4';
const READ = 'live/iguide-read-aloud.mp4';
/** The bottom half of the app: the plan / progress card above the iRecall box. */
const CARD: Frame = { x: 0.467, y: 0.737, zoom: 1.9 };

/**
 * The cuts in order (times measured on the captures), trimmed to the voice-over: line 1 (7.2 s,
 * from 0.3 s) runs over attaching and typing; line 2 (5.5 s, from 7.9 s) over the plan, the agents
 * and Ready; a short beat later the guide reads step 1 aloud. Each cut overlaps the last by DISSOLVE, so
 * the cut lengths here are what land each join on its line. Re-speaking a line means re-trimming.
 */
const CUTS: readonly Cut[] = [
  // "Introducing I-guide…": a clip is attached from the Gallery…
  { clip: MAKING, fromS: 4.6, toS: 7.6, start: { x: 0.5, y: 0.5, zoom: 1.25 }, end: { x: 0.5, y: 0.55, zoom: 1.35 } },
  // …and the request is typed into iRecall.
  { clip: MAKING, fromS: 7.6, toS: 12.8, start: { x: 0.467, y: 0.737, zoom: 1.6 }, end: CARD },
  // "Attach a video, type to create a guide…": sent, Muse Spark plans it.
  { clip: MAKING, fromS: 26.4, toS: 28.6, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // "…and wait…": Make iGuide, the agents start.
  { clip: MAKING, fromS: 41.0, toS: 43.0, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // "…step-by-step result…": Ready, all 4 steps done.
  { clip: MAKING, fromS: 90.6, toS: 92.5, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // "…which you can play.": the guide reads step 1 aloud (the app's own voice).
  { clip: READ, fromS: 2.4, toS: 7.4, start: { x: 0.5, y: 0.5, zoom: 1 }, end: { x: 0.42, y: 0.42, zoom: 1.25 }, audio: true },
];

/** Where each cut starts on the composition, in frames (each overlaps the last by DISSOLVE). */
const PLACED = CUTS.reduce<{ at: number; list: (Cut & { from: number; frames: number })[] }>(
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

/** Places the capture for a framing, never letting an edge show inside the frame. */
function placement({ x, y, zoom }: Frame) {
  const w = W * zoom;
  const h = CAPTURE_H * zoom;
  const left = Math.min(0, Math.max(W - w, W / 2 - x * w));
  const top = Math.min(0, Math.max(H - h, H / 2 - y * h));
  return { position: 'absolute', left, top, width: w, height: h } as const;
}

function CutView({ cut, isFirst }: { cut: (typeof PLACED)[number]; isFirst: boolean }) {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, cut.frames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const cam = { x: cut.start.x + (cut.end.x - cut.start.x) * t, y: cut.start.y + (cut.end.y - cut.start.y) * t, zoom: cut.start.zoom + (cut.end.zoom - cut.start.zoom) * t };
  const opacity = isFirst ? 1 : interpolate(frame, [0, DISSOLVE], [0, 1], { extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo src={staticFile(cut.clip)} trimBefore={Math.round(cut.fromS * FPS)} muted={cut.audio !== true} style={placement(cam)} />
    </AbsoluteFill>
  );
}

/** The feature's name, top left over the captures: a dark frosted pill, so it reads on any frame. */
function NameTag() {
  return (
    <div
      style={{
        position: 'absolute',
        left: 48,
        top: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 26px 12px 20px',
        borderRadius: 999,
        background: 'rgba(13, 27, 30, 0.72)',
        border: '1px solid rgba(95, 195, 217, 0.35)',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.35)',
        opacity: useEnter(4),
      }}
    >
      <div style={{ width: 14, height: 14, borderRadius: '50%', background: COLOR.tealLight }} />
      <div style={{ fontFamily: ROBOTO, fontWeight: 500, fontSize: 38, color: COLOR.white, letterSpacing: 0.5 }}>iGuide</div>
    </div>
  );
}

export function IGuide() {
  return (
    <AbsoluteFill style={{ background: APP_BG }}>
      <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden' }}>
        {PLACED.map((cut, index) => (
          <Sequence key={`${cut.clip}-${String(cut.fromS)}`} from={cut.from} durationInFrames={cut.frames + (index === PLACED.length - 1 ? 15 : DISSOLVE)}>
            <CutView cut={cut} isFirst={index === 0} />
          </Sequence>
        ))}
      </div>
      <NameTag />
      {VO.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/iguide-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
