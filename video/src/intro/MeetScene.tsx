// Intro scene 1: nimbytes presented, as in the promo's "meet" scene but on a white page. The logo
// and "AI-powered filesystem, built on Meta AI." in the centre, faint app captures drifting at
// depth behind them, and the current app (Gallery with iListen) fading in as it zooms out into place at the bottom edge.
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { Logo } from '../components/Logo';
import { useEnter, useZoomFade } from '../components/motion';
import { DISPLAY } from '../fonts';
import { COLOR } from '../theme';

/** The main capture: the app's Gallery with iListen recordings (its own window bar included). */
const MAIN_SHOT = 'shots/gallery-ilisten.jpg';

/** Meta's logo, cropped tight from the owner's copy. */
const META_LOGO = 'shots/meta-logo.png';

/** A capture floating behind the title at a depth: fainter, smaller and blurrier the further back, drifting slowly. */
function DepthShot({ src, x, y, w, depth, delay }: { src: string; x: number; y: number; w: number; depth: number; delay: number }) {
  const frame = useCurrentFrame();
  const enter = useEnter(delay);
  const drift = frame * 0.35 * depth;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - drift * (x < 960 ? 1 : -1) * 0.6,
        top: y - drift * 0.4,
        width: w,
        opacity: enter * (0.12 + 0.18 * depth),
        filter: `blur(${String((1 - depth) * 6)}px)`,
        transform: `scale(${String(0.8 + 0.2 * depth)})`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 30px 70px rgba(13, 27, 30, 0.18)',
      }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

/** The app window, entering with the zoom-fade, then never quite still: it drifts up and in slowly, with a gentle float, until the scene ends. */
function AppWindow({ delay, src }: { delay: number; src: string }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const zoomFade = useZoomFade(delay);
  const drift = interpolate(frame, [delay, durationInFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const float = Math.sin((frame - delay) / 22) * 3;
  return (
    <div
      style={{
        position: 'absolute',
        left: 400,
        top: 730,
        width: 1120,
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${COLOR.cardBorder}`,
        boxShadow: '0 40px 100px rgba(13, 27, 30, 0.22)',
        opacity: zoomFade.opacity,
        transform: `${zoomFade.transform} translateY(${String(-drift * 22 + float)}px) scale(${String(1 + 0.025 * drift)})`,
        transformOrigin: 'center top',
      }}
    >
      <Img src={staticFile(src)} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

/**
 * "AI-powered filesystem, built on [Meta logo]", entering with the zoom-fade (the promo's size and
 * face). With `second`, the second line is that text alone, no logo.
 */
function Tagline({ delay, second }: { delay: number; second?: string }) {
  const line = { fontFamily: DISPLAY, fontWeight: 200, fontSize: 72, lineHeight: 1.08, textAlign: 'center' } as const;
  return (
    <div style={{ marginTop: 30, ...useZoomFade(delay) }}>
      <div style={{ ...line, color: COLOR.ink }}>AI-powered filesystem,</div>
      {second !== undefined ? (
        <div style={{ ...line, color: COLOR.teal }}>{second}</div>
      ) : (
      <div style={{ ...line, color: COLOR.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 22 }}>
        built on
        {/* Meta's own logo (mark + wordmark), on white; multiply keeps its white box invisible. */}
        <Img src={staticFile(META_LOGO)} style={{ height: 64, marginTop: 8, mixBlendMode: 'multiply' }} />
      </div>
      )}
    </div>
  );
}

/** The scene's captures; another composition can pass its own copies (e.g. face-blurred). */
export interface MeetShots {
  main: string;
  results: string;
  guide: string;
}
const DEFAULT_SHOTS: MeetShots = { main: MAIN_SHOT, results: 'shots/depth-results.png', guide: 'shots/depth-guide.png' };

/**
 * The scene.
 * @param second - The tagline's second line as text only (no Meta logo); leave out for "built on [Meta logo]".
 * @param shots - The captures behind and under the title.
 */
export function MeetScene({ second, shots = DEFAULT_SHOTS }: { second?: string; shots?: MeetShots } = {}) {
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <DepthShot src={shots.results} x={-80} y={150} w={620} depth={0.35} delay={6} />
      <DepthShot src={shots.guide} x={1380} y={110} w={600} depth={0.55} delay={12} />
      <DepthShot src={shots.main} x={1300} y={640} w={520} depth={0.8} delay={18} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 200 }}>
        <div style={{ opacity: useEnter(4) }}>
          <Logo size={120} color={COLOR.ink} />
        </div>
        <Tagline delay={16} {...(second === undefined ? {} : { second })} />
      </AbsoluteFill>
      <AppWindow delay={40} src={shots.main} />
    </AbsoluteFill>
  );
}
