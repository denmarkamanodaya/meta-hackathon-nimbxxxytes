// The product half: meet nimbytes, zero bytes, Meta AI understands, iRecall, iGuide and iRead, all
// on real captures of the Mac app (public/shots stills, public/live clips) under a moving camera.
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Logo } from '../components/Logo';
import { riseStyle, useEnter } from '../components/motion';
import { Pill } from '../components/Pill';
import { layCuts, Ring, Window, type Cam, type Cut, type PlacedCut, type Spot } from '../components/Window';
import { INTER } from '../fonts';
import { COLOR, NIGHT } from '../theme';
import { at, During, HEAD, type SceneProps } from './parts';

/** The big window on the right of a product scene. */
const WIN = { left: 800, top: 330, width: 1000 } as const;

/** Meet nimbytes: the lockup, the tagline, then the Gallery rising in. */
export function MeetScene() {
  const frame = useCurrentFrame();
  const logo = useEnter(4);
  const lift = interpolate(frame, [70, 100], [0, -250], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Backdrop glowAt="center">
      <DepthShot src="shots/depth-results.png" x={-80} y={150} w={620} depth={0.35} tilt={14} delay={6} />
      <DepthShot src="shots/depth-guide.png" x={1380} y={110} w={600} depth={0.55} tilt={-14} delay={12} />
      <DepthShot src="shots/gallery.png" x={1300} y={640} w={520} depth={0.8} tilt={-10} delay={18} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 300 + lift * 0.4 }}>
        <div style={{ transform: `scale(${String(0.8 + 0.2 * logo)})`, opacity: logo }}>
          <Logo size={120} />
        </div>
        <div style={{ marginTop: 30 }}>
          <Headline first="AI-powered filesystem," second="built on Meta AI." size={72} align="center" delay={16} />
        </div>
      </AbsoluteFill>
      <Window capture={{ still: 'shots/gallery.png' }} cams={[{ at: 40, x: 0.5, y: 0.5, zoom: 1 }, { at: 220, x: 0.53, y: 0.47, zoom: 1.1 }]} left={400} top={1080 + lift * 1.4} width={1120} delay={40} />
    </Backdrop>
  );
}

/** A real capture floating in the background at a depth: it drifts slower the further back it is. */
function DepthShot({ src, x, y, w, depth, tilt, delay }: { src: string; x: number; y: number; w: number; depth: number; tilt: number; delay: number }) {
  const frame = useCurrentFrame();
  const enter = useEnter(delay);
  const drift = frame * (0.35 * depth);
  return (
    <div
      style={{
        position: 'absolute',
        left: x - drift * (x < 960 ? 1 : -1) * 0.6,
        top: y - drift * 0.4,
        width: w,
        opacity: enter * (0.25 + 0.3 * depth),
        filter: `blur(${String((1 - depth) * 5)}px)`,
        transform: `perspective(1600px) rotateY(${String(tilt)}deg) scale(${String(0.8 + 0.2 * depth)})`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
      }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

/**
 * Camera for a run of cuts that never holds still: each cut starts on its own framing, then
 * slowly pushes in (about 8%) and drifts while it plays. The next cut dissolves in over it.
 */
function cutCams(cuts: readonly PlacedCut[], frame: (index: number) => Omit<Cam, 'at'>): Cam[] {
  return cuts.flatMap((cut, index) => {
    const f = frame(index);
    const push = { x: f.x + 0.012, y: f.y + 0.008, zoom: f.zoom * 1.08 };
    return [
      { at: cut.from, ...f },
      { at: cut.from + cut.frames - 1, ...push },
    ];
  });
}

/** Zero bytes: Finder's Get Info (3.4 GB, zero bytes on disk), then the clip playing in nimbytes at
 * real speed: the two parents walking in. */
export function ZeroScene({ scene }: SceneProps) {
  const playAt = at(scene, 1) - 4;
  const info = layCuts([{ clip: 'shots/finder-info.png', fromS: 0, durS: playAt / 30 }], 0, playAt);
  const play = layCuts([{ clip: 'raw/play.mp4', fromS: 7.6, durS: 4.8 }, { clip: 'raw/play.mp4', fromS: 12.4, durS: 4.4 }], playAt, scene.durationInFrames - playAt);
  const cams: Cam[] = [
    { at: 0, x: 0.5, y: 0.5, zoom: 1 },
    { at: 8, x: 0.52, y: 0.48, zoom: 1.05 },
    { at: 34, x: 0.72, y: 0.22, zoom: 2.6 },
    { at: playAt - 6, x: 0.71, y: 0.215, zoom: 2.8 },
    ...cutCams(play, (i) => (i === 0 ? { x: 0.42, y: 0.42, zoom: 1.35 } : { x: 0.45, y: 0.42, zoom: 1.45 })),
  ];
  return (
    <Backdrop>
      <div style={HEAD}>
        <Headline first="3.4 GB file." second="Zero bytes on disk." size={96} />
      </div>
      <Window
        capture={{ cuts: [...info, ...play] }}
        cams={cams}
        {...WIN}
        overlays={(zoom) => (
          <>
            <Ring spot={{ x: 0.793, y: 0.122, w: 0.03, h: 0.03 }} from={34} to={playAt - 2} zoom={zoom} color="#FFE58A" />
            <Ring spot={{ x: 0.633, y: 0.233, w: 0.135, h: 0.026 }} from={44} to={playAt - 2} zoom={zoom} label="Zero bytes on disk" />
          </>
        )}
      />
    </Backdrop>
  );
}

/** Meta AI understands: the clip page, the camera moving to its moments, speech and faces. */
export function UnderstandScene() {
  const cams: Cam[] = [
    { at: 0, x: 0.5, y: 0.5, zoom: 1 },
    { at: 30, x: 0.5, y: 0.5, zoom: 1 },
    { at: 60, x: 0.86, y: 0.32, zoom: 2.1 },
  ];
  return (
    <Backdrop glowAt="top-right">
      <div style={HEAD}>
        <Headline first="Meta AI watches," second="listens, understands." size={96} />
      </div>
      <Window
        capture={{ still: 'shots/clip-page.png' }}
        cams={cams}
        {...WIN}
        overlays={(zoom) => (
          <>
            <Ring spot={{ x: 0.835, y: 0.045, w: 0.16, h: 0.035 }} from={62} zoom={zoom} label="Moments · Speech · Faces" />
            <Ring spot={{ x: 0.835, y: 0.09, w: 0.16, h: 0.45 }} from={78} zoom={zoom} color="#FFE58A" />
          </>
        )}
      />
    </Backdrop>
  );
}

/** A search take: each query is a typing cut (camera on the box) then a result cut (camera on the
 * moments), all at real speed. */
/** The Kristoff take (recorded at 1600×900): typing the query, the app searching, the two
 * moments Muse Spark found, then his speech playing. All at real speed. */
const KRISTOFF: readonly Cut[] = [
  { clip: 'raw/kristoff.mp4', fromS: 2.2, durS: 2.3 },
  { clip: 'raw/kristoff.mp4', fromS: 5.6, durS: 0.9 },
  { clip: 'raw/kristoff.mp4', fromS: 9.3, durS: 1.2 },
  { clip: 'raw/kristoff-play.mp4', fromS: 4.6, durS: 1.6 },
];

/** Framing per cut: the search box, the searching page, the answer, the playing clip. */
const KRISTOFF_FRAMES: readonly Omit<Cam, 'at'>[] = [
  { x: 0.4, y: 0.9, zoom: 1.9 },
  { x: 0.4, y: 0.5, zoom: 1.2 },
  { x: 0.465, y: 0.3, zoom: 1.4 },
  { x: 0.45, y: 0.36, zoom: 1.75 },
];

/** The speech search take: typing, the app searching, the moment with the words. */
const SAID: readonly Cut[] = [
  { clip: 'raw/said.mp4', fromS: 2.0, durS: 2.0 },
  { clip: 'raw/said.mp4', fromS: 5.6, durS: 1.2 },
  { clip: 'raw/said.mp4', fromS: 9.0, durS: 2.4 },
];

/** The face search take (Browny): typing, the app searching, the moments with the face chip. */
const WHO: readonly Cut[] = [
  { clip: 'raw/who.mp4', fromS: 1.4, durS: 2.6 },
  { clip: 'raw/who.mp4', fromS: 5.0, durS: 1.2 },
  { clip: 'raw/who.mp4', fromS: 7.4, durS: 1.1 },
];

/** Framing for a typing → searching → results take; the results frame keeps the whole list, thumbnails included. */
const QUERY_FRAMES: readonly Omit<Cam, 'at'>[] = [
  { x: 0.4, y: 0.9, zoom: 1.9 },
  { x: 0.4, y: 0.5, zoom: 1.2 },
  { x: 0.47, y: 0.32, zoom: 1.35 },
];

/** A take's ring: where the answer sits in that take's capture, and what it says. */
interface TakeRing {
  spot: Spot;
  label: string;
}

/**
 * Search, line by line, in one window that never leaves the screen: the camera runs from the
 * clip page's tabs (Meta AI analyzes) into the Kristoff search, then what was said, then who was
 * there. Each take swaps in under a whip-pan; the camera keeps moving through every cut.
 */
export function SearchScene({ scene }: SceneProps) {
  const [l1, l2, l3] = [at(scene, 1), at(scene, 2), at(scene, 3)];
  const end = scene.durationInFrames;
  const analyze = layCuts([{ clip: 'shots/clip-page.png', fromS: 0, durS: l1 / 30 }], 0, l1);
  const kristoff = layCuts(KRISTOFF, l1, l2 - l1);
  const said = layCuts(SAID, l2, l3 - l2);
  const who = layCuts(WHO, l3, end - l3);
  const cuts = [...analyze, ...kristoff, ...said, ...who];
  const cams: Cam[] = [
    { at: 0, x: 0.5, y: 0.5, zoom: 1 },
    { at: 20, x: 0.5, y: 0.5, zoom: 1.04 },
    { at: 50, x: 0.86, y: 0.25, zoom: 2.1 },
    { at: l1 - 6, x: 0.87, y: 0.26, zoom: 2.25 },
    ...cutCams(kristoff, (i) => KRISTOFF_FRAMES[i] ?? { x: 0.5, y: 0.5, zoom: 1 }),
    ...cutCams(said, (i) => QUERY_FRAMES[i] ?? { x: 0.5, y: 0.5, zoom: 1 }),
    ...cutCams(who, (i) => QUERY_FRAMES[i] ?? { x: 0.5, y: 0.5, zoom: 1 }),
  ];
  const answer = (take: PlacedCut[]): { from: number; frames: number } => take[2] ?? take[take.length - 1] ?? { from: 0, frames: 1 };
  const rings: { cut: { from: number; frames: number }; ring: TakeRing }[] = [
    { cut: answer(kristoff), ring: { spot: { x: 0.143, y: 0.2, w: 0.645, h: 0.12 }, label: 'Kristoff, speaking · 5:02' } },
    { cut: answer(said), ring: { spot: { x: 0.118, y: 0.29, w: 0.706, h: 0.1 }, label: 'Found in the speech' } },
    { cut: answer(who), ring: { spot: { x: 0.118, y: 0.165, w: 0.706, h: 0.225 }, label: 'Found by face' } },
  ];
  const parts = [
    { from: 0, to: l1, first: 'Meta AI analyzes', second: 'every clip.', query: null },
    { from: l1, to: l2, first: 'Search your footage', second: 'like text.', query: 'Find Kristoff making a speech' },
    { from: l2, to: l3, first: 'By what', second: 'was said.', query: 'Find where the speech mentions sixty years of love and memories' },
    { from: l3, to: end + 20, first: 'By who', second: 'was there.', query: 'Find every moment with Browny' },
  ];
  return (
    <Backdrop>
      {parts.map((part) => (
        <During key={part.first} from={part.from} to={part.to + 6}>
          <div style={HEAD}>
            <Headline first={part.first} second={part.second} size={96} delay={part.from} />
          </div>
          {part.query !== null && (
            <div style={{ position: 'absolute', left: 120, top: 400, width: 600, lineHeight: 1.35 }}>
              <Pill background={NIGHT.accent} color={NIGHT.bgDeep} size={26} delay={part.from + 4}>
                {`“${part.query}”`}
              </Pill>
            </div>
          )}
        </During>
      ))}
      <Window
        capture={{ cuts }}
        cams={cams}
        {...WIN}
        overlays={(zoom) => (
          <>
            <Ring spot={{ x: 0.838, y: 0.032, w: 0.157, h: 0.028 }} from={52} to={l1 - 2} zoom={zoom} label="46 moments · 11 speech · 26 faces" />
            <Ring spot={{ x: 0.924, y: 0.032, w: 0.048, h: 0.028 }} from={76} to={l1 - 2} zoom={zoom} color="#FFE58A" />
            {rings.map(({ cut, ring }) => (
              <Ring key={ring.label} spot={ring.spot} from={cut.from + 3} to={cut.from + cut.frames} zoom={zoom} label={ring.label} />
            ))}
          </>
        )}
      />
    </Backdrop>
  );
}

/**
 * Copies: the Gallery's Copies view (a real capture). The camera moves from the Near-copy tile to
 * the "Looks like a copy" card with its similarity score, then to Remove this copy.
 */
export function CopiesScene({ scene }: SceneProps) {
  const second = at(scene, 1);
  const end = scene.durationInFrames;
  const cams: Cam[] = [
    { at: 0, x: 0.5, y: 0.5, zoom: 1 },
    { at: 18, x: 0.5, y: 0.5, zoom: 1.02 },
    { at: 46, x: 0.3, y: 0.24, zoom: 1.9 },
    { at: second - 6, x: 0.31, y: 0.25, zoom: 2.0 },
    { at: second + 24, x: 0.88, y: 0.45, zoom: 2.2 },
    { at: end + 18, x: 0.875, y: 0.47, zoom: 2.4 },
  ];
  return (
    <Backdrop glowAt="top-right">
      <div style={HEAD}>
        <Headline first="Duplicates," second="found and scored." size={92} />
      </div>
      <Window
        capture={{ still: 'shots/copies.png' }}
        cams={cams}
        {...WIN}
        overlays={(zoom) => (
          <>
            <Ring spot={{ x: 0.506, y: 0.074, w: 0.06, h: 0.032 }} from={30} to={second} zoom={zoom} color="#FFE58A" />
            <Ring spot={{ x: 0.152, y: 0.228, w: 0.1, h: 0.165 }} from={48} to={second + 4} zoom={zoom} label="Near-copy, found by itself" />
            <Ring spot={{ x: 0.786, y: 0.37, w: 0.2, h: 0.065 }} from={second + 26} zoom={zoom} label="99% the same: confidence score" />
            <Ring spot={{ x: 0.795, y: 0.52, w: 0.096, h: 0.042 }} from={second + 50} zoom={zoom} color="#FFE58A" />
          </>
        )}
      />
    </Backdrop>
  );
}

/**
 * iGuide, line by line, at real speed:
 * 1. "Create short-form video explainer automatically.": the Meta AI agents tick through their stages.
 * 2. "SAM provides a step-by-step process and read each aloud.": the steps, with SAM's trace.
 * 3. The app reading a step aloud in the Mac's voice (heard, and captioned in yellow). Pexels footage.
 */
export function IGuideScene({ scene }: SceneProps) {
  const second = at(scene, 1);
  const third = at(scene, 2);
  const agents = layCuts(
    [
      { clip: 'raw/pipe-a.mp4', fromS: 133.5, durS: 1.5 },
      { clip: 'raw/pipe-a.mp4', fromS: 150, durS: 1.4 },
      { clip: 'raw/pipe-a.mp4', fromS: 164, durS: 1.4 },
      { clip: 'raw/pipe-a.mp4', fromS: 177, durS: 1.4 },
    ],
    0,
    second,
  );
  const steps = layCuts([{ clip: 'raw/pipe-a.mp4', fromS: 182.6, durS: 3.4 }], second, third - second);
  const reading = layCuts([{ clip: 'raw/iguide2.mp4', fromS: 10.0, durS: 6.0 }], third, scene.durationInFrames - third);
  const cuts = [...agents, ...steps, ...reading];
  const frameOf = (i: number): Omit<Cam, 'at'> => (i < agents.length ? { x: 0.28, y: 0.16, zoom: 2.3 } : { x: 0.36, y: 0.36, zoom: 1.5 });
  const badge = (i: number) => (i < agents.length ? 'Meta AI agents at work' : i === agents.length ? 'SAM 3.1 traces each step' : 'Reading it aloud');
  return (
    <Backdrop glowAt="top-right">
      <During from={0} to={second + 6}>
        <div style={HEAD}>
          <Headline first="Video explainers," second="made automatically." size={92} />
        </div>
      </During>
      <During from={second}>
        <div style={HEAD}>
          <Headline first="Step by step," second="read aloud." size={92} delay={second} />
        </div>
      </During>
      <Window
        capture={{ cuts }}
        cams={cutCams(cuts, frameOf)}
        {...WIN}
        overlays={(zoom) => (
          <>
            <Ring spot={{ x: 0.115, y: 0.12, w: 0.39, h: 0.135 }} from={4} to={second - 2} zoom={zoom} label="Steps · frames · SAM 3.1 · voice" />
            <Ring spot={{ x: 0.277, y: 0.095, w: 0.397, h: 0.53 }} from={second + 4} to={third - 2} zoom={zoom} color="#FFE58A" label="Traced by SAM 3.1" />
          </>
        )}
      />
      {cuts.map((cut, i) => (
        <During key={cut.from} from={cut.from} to={cut.from + cut.frames}>
          <div style={{ position: 'absolute', left: WIN.left + 24, top: WIN.top + 56 }}>
            <Pill background={i < agents.length ? COLOR.yellow : NIGHT.accent} color={NIGHT.bgDeep}>{badge(i)}</Pill>
          </div>
        </During>
      ))}
      <div style={{ position: 'absolute', right: 120, top: 280, fontFamily: INTER, fontSize: 20, color: NIGHT.textSoft }}>Sample footage: Pexels (alleksana). No endorsement implied.</div>
    </Backdrop>
  );
}

/** iRead: the sample bill, snapped like a photo, then nimbytes reading it aloud in the Mac's own
 * voice (the line marked `device` in vo-lines.json), with its words in the captions. */
export function IReadScene({ scene }: SceneProps) {
  const frame = useCurrentFrame();
  const reading = at(scene, 1);
  const snap = Math.round(reading * 0.38);
  const flash = interpolate(frame, [snap, snap + 3, snap + 14], [0, 0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const paperIn = interpolate(frame, [4, 24], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const paperOut = interpolate(frame, [reading - 16, reading], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const corners = frame >= snap - 18 && frame < snap + 20;
  const bars = Array.from({ length: 9 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin((frame - reading) / 4 + i * 0.9)));
  return (
    <Backdrop>
      <div style={HEAD}>
        <Headline first="Snap it." second="Hear it." size={110} />
        <div style={{ marginTop: 26, ...riseStyle(useEnter(12)) }}>
          <Pill background="rgba(95,195,217,0.15)" color={NIGHT.accent}>
            iRead
          </Pill>
        </div>
      </div>
      <During from={0} to={reading + 2}>
        <div
          style={{
            position: 'absolute',
            left: 1040,
            top: 150,
            width: 560,
            transform: `translate(${String((1 - paperIn) * 300 + paperOut * 200)}px, ${String((1 - paperIn) * 60)}px) rotate(${String(-6 + paperIn * 3)}deg) scale(${String(1 - paperOut * 0.4)})`,
            opacity: paperIn * (1 - paperOut),
            boxShadow: '0 40px 100px rgba(0,0,0,0.6)',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        >
          <Img src={staticFile('demo-docs/water-bill.png')} style={{ width: '100%', display: 'block' }} />
        </div>
        {corners && (
          <div style={{ position: 'absolute', left: 1000, top: 110, width: 660, height: 880 }}>
            {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
              <div
                key={c}
                style={{
                  position: 'absolute',
                  width: 70,
                  height: 70,
                  borderColor: NIGHT.accent,
                  borderStyle: 'solid',
                  borderWidth: `${c.startsWith('t') ? 6 : 0}px ${c.endsWith('r') ? 6 : 0}px ${c.startsWith('b') ? 6 : 0}px ${c.endsWith('l') ? 6 : 0}px`,
                  ...(c.startsWith('t') ? { top: 0 } : { bottom: 0 }),
                  ...(c.endsWith('l') ? { left: 0 } : { right: 0 }),
                }}
              />
            ))}
          </div>
        )}
        <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
      </During>
      <During from={reading - 4}>
        <Window
          capture={{ still: 'shots/iread-reading.png' }}
          cams={[{ at: reading - 4, x: 0.9, y: 0.3, zoom: 2.6 }, { at: reading + 60, x: 0.9, y: 0.33, zoom: 2.9 }, { at: scene.durationInFrames + 16, x: 0.905, y: 0.35, zoom: 3.1 }]}
          {...WIN}
          overlays={(zoom) => (
            <>
              <Ring spot={{ x: 0.84, y: 0.315, w: 0.152, h: 0.06 }} from={reading + 6} zoom={zoom} color="#FFE58A" />
              <Ring spot={{ x: 0.84, y: 0.382, w: 0.074, h: 0.036 }} from={reading + 14} zoom={zoom} label="Reading it aloud" />
            </>
          )}
        />
        <div style={{ position: 'absolute', left: 120, top: 430, display: 'flex', alignItems: 'center', gap: 8, height: 90 }}>
          {bars.map((h, i) => (
            <div key={String(i)} style={{ width: 12, height: 90 * h, borderRadius: 6, background: COLOR.yellow }} />
          ))}
        </div>
      </During>
    </Backdrop>
  );
}
