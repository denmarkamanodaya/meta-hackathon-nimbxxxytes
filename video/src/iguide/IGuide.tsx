// NimbytesFeatureIGuide: the iGuide feature from real Mac captures, on the white page. A floating
// app window plays the cuts in order: the request being typed (with the clip attached), Muse Spark's
// plan, Make iGuide and the agents running to Ready, then the finished guide reading its steps
// aloud (the app's own device voice, captured with the screen). Cuts dissolve into each other and
// the camera eases between framings inside the window. Captures: public/live/iguide-*.mp4. The
// voice-over (src/iguide/vo-lines.json) plays over the typing.
import { AbsoluteFill, Audio, Easing, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { useZoomFade } from '../components/motion';
import { placeLines } from '../components/voTiming';
import { COLOR } from '../theme';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const FPS = 30;
/** Frames each cut dissolves in over the one before it. */
const DISSOLVE = 10;

/** A camera framing: the capture point at the window's centre (0–1 from top left) and the zoom. */
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

const MAKING = 'live/iguide-making.mp4';
const READ = 'live/iguide-read-aloud.mp4';
/** The bottom half of the window: the plan / progress card above the iRecall box. */
const CARD: Frame = { x: 0.467, y: 0.737, zoom: 1.9 };

/** The cuts in order (times measured on the captures). */
const CUTS: readonly Cut[] = [
  // The clip is attached; the request is typed into iRecall.
  { clip: MAKING, fromS: 7.6, toS: 18.2, start: { x: 0.467, y: 0.737, zoom: 1.6 }, end: CARD },
  // Sent: Muse Spark plans the guide (4 steps, the models that run them).
  { clip: MAKING, fromS: 23.8, toS: 30.0, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // Make iGuide: the agents start, step 1 of 4.
  { clip: MAKING, fromS: 40.0, toS: 48.0, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // Frames done, SAM circling the controls.
  { clip: MAKING, fromS: 62.0, toS: 67.0, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // The backup voice, then Ready (all 4 steps done).
  { clip: MAKING, fromS: 84.0, toS: 95.0, start: CARD, end: { ...CARD, zoom: 2.0 } },
  // The finished guide reads steps 1–3 aloud, each with its SAM-circled still.
  { clip: READ, fromS: 2.4, toS: 19.8, start: { x: 0.5, y: 0.5, zoom: 1 }, end: { x: 0.4, y: 0.4, zoom: 1.35 }, audio: true },
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

/** The voice-over (British female): it plays over the first cut, while the request is typed. */
const VO = placeLines(lines, generated, { min: 0, lead: 0.3, gap: 0.3, tail: 0 }).lines;

/** The composition's length in frames, with a short hold on the last cut. */
export const IGUIDE_FRAMES = (PLACED.at(-1)?.from ?? 0) + (PLACED.at(-1)?.frames ?? 0) + 15;

/** The window: 1640 px wide at the captures' aspect (3840 × 2325). */
const W = 1640;
const H = Math.round((W * 2325) / 3840);

/** Places the capture for a framing, never letting an edge show inside the window. */
function placement({ x, y, zoom }: Frame) {
  const w = W * zoom;
  const h = H * zoom;
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

export function IGuide() {
  const enter = useZoomFade(0);
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: W, height: H, borderRadius: 18, overflow: 'hidden', border: `1px solid ${COLOR.cardBorder}`, boxShadow: '0 40px 100px rgba(13, 27, 30, 0.22)', background: '#141414', ...enter }}>
        {PLACED.map((cut, index) => (
          <Sequence key={`${cut.clip}-${String(cut.fromS)}`} from={cut.from} durationInFrames={cut.frames + (index === PLACED.length - 1 ? 15 : DISSOLVE)}>
            <CutView cut={cut} isFirst={index === 0} />
          </Sequence>
        ))}
      </div>
      {VO.map((line) => (
        <Sequence key={line.id} from={line.from} durationInFrames={line.durationInFrames}>
          <Audio src={staticFile(`audio/iguide-vo/${line.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
