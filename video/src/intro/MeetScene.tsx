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

/** A capture floating behind the title at a depth: fainter, smaller and blurrier the further back, drifting slowly. */
function DepthShot({ src, x, y, w, depth, tilt, delay }: { src: string; x: number; y: number; w: number; depth: number; tilt: number; delay: number }) {
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
        transform: `perspective(1600px) rotateY(${String(tilt)}deg) scale(${String(0.8 + 0.2 * depth)})`,
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
function AppWindow({ delay }: { delay: number }) {
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
      <Img src={staticFile(MAIN_SHOT)} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

/** "AI-powered filesystem, built on Meta AI.", entering with the zoom-fade (the promo's size and face). */
function Tagline({ delay }: { delay: number }) {
  const line = { fontFamily: DISPLAY, fontWeight: 200, fontSize: 72, lineHeight: 1.08, textAlign: 'center' } as const;
  return (
    <div style={{ marginTop: 30, ...useZoomFade(delay) }}>
      <div style={{ ...line, color: COLOR.ink }}>AI-powered filesystem,</div>
      <div style={{ ...line, color: COLOR.teal }}>built on Meta AI.</div>
    </div>
  );
}

export function MeetScene() {
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <DepthShot src="shots/depth-results.png" x={-80} y={150} w={620} depth={0.35} tilt={14} delay={6} />
      <DepthShot src="shots/depth-guide.png" x={1380} y={110} w={600} depth={0.55} tilt={-14} delay={12} />
      <DepthShot src={MAIN_SHOT} x={1300} y={640} w={520} depth={0.8} tilt={-10} delay={18} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 200 }}>
        <div style={{ opacity: useEnter(4) }}>
          <Logo size={120} color={COLOR.ink} />
        </div>
        <Tagline delay={16} />
      </AbsoluteFill>
      <AppWindow delay={40} />
    </AbsoluteFill>
  );
}
