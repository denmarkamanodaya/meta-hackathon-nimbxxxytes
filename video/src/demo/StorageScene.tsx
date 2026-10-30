// Demo scene 4 (timed to its two voice lines): storing memories is expensive and tedious. White page, the line on the left;
// on the right, storage and media devices pop in one by one. Just before line 2 the line fades out
// quickly and the question replaces it ("What if there is a solution?"); the devices pop out as the scene ends.
import { Camera, Cloud, Disc3, HardDrive, Images, LayoutGrid, Laptop, MemoryStick, Smartphone, Tablet, Usb } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { riseStyle, useEnter } from '../components/motion';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import { lineOf, type DemoSceneProps } from './timeline';

/** The devices: where each sits in the cluster (px), its size, tilt, accent and when it pops in. */
const DEVICES: readonly { Icon: LucideIcon; x: number; y: number; size: number; tilt: number; color: string; at: number }[] = [
  { Icon: HardDrive, x: 250, y: 40, size: 190, tilt: -6, color: COLOR.teal, at: 10 },
  { Icon: Smartphone, x: 40, y: 230, size: 150, tilt: 8, color: COLOR.ink, at: 14 },
  { Icon: Usb, x: 500, y: 200, size: 130, tilt: 12, color: COLOR.red, at: 18 },
  { Icon: Laptop, x: 210, y: 300, size: 200, tilt: -3, color: COLOR.ink, at: 22 },
  { Icon: MemoryStick, x: 20, y: 30, size: 120, tilt: -10, color: COLOR.red, at: 26 },
  { Icon: Camera, x: 470, y: 400, size: 150, tilt: 6, color: COLOR.teal, at: 29 },
  { Icon: Tablet, x: 60, y: 450, size: 140, tilt: -8, color: COLOR.teal, at: 32 },
  { Icon: Disc3, x: 520, y: 20, size: 120, tilt: 0, color: COLOR.inkSoft, at: 35 },
  { Icon: Cloud, x: 300, y: 540, size: 130, tilt: 4, color: COLOR.inkSoft, at: 38 },
  { Icon: Images, x: 420, y: 600, size: 110, tilt: -6, color: COLOR.red, at: 41 },
  { Icon: LayoutGrid, x: 150, y: 600, size: 110, tilt: 10, color: COLOR.ink, at: 44 },
];

/** Frames before the end at which the devices start popping out. */
const OUT = 16;

/** One device tile: pops in with a small overshoot, pops out (last first) at the end. */
function Device({ Icon, x, y, size, tilt, color, at, outAt }: (typeof DEVICES)[number] & { outAt: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - at, fps, durationInFrames: 14, config: { damping: 11, stiffness: 180 } });
  const gone = spring({ frame: frame - outAt, fps, durationInFrames: 10, config: { damping: 200 } });
  const scale = Math.max(0, pop - gone);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: size * 0.22,
        background: COLOR.white,
        border: `1px solid ${COLOR.cardBorder}`,
        boxShadow: '0 18px 40px rgba(13, 27, 30, 0.12)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: Math.min(1, scale * 2),
        transform: `scale(${String(scale)}) rotate(${String(tilt)}deg)`,
      }}
    >
      <Icon size={size * 0.48} strokeWidth={1.4} color={color} />
    </div>
  );
}

export function StorageScene({ scene }: DemoSceneProps) {
  const { durationInFrames } = useVideoConfig();
  const frame = useCurrentFrame();
  // Timed to the voice: "expensive" late in line 1; the line fades out and the question comes in just
  // before line 2 ("But what if there is a solution?").
  const first = lineOf(scene, 0);
  const expensiveAt = first.from + Math.round(first.durationInFrames * 0.6);
  const QUESTION = lineOf(scene, 1).from - 8;
  const lineOut = interpolate(frame, [QUESTION, QUESTION + 6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const lineIn = useEnter(2);
  const redIn = useEnter(expensiveAt);
  const questionIn = useEnter(QUESTION + 4);
  const text = { fontFamily: ROBOTO, fontWeight: 300, fontSize: 76, lineHeight: 1.18, color: COLOR.ink } as const;
  const column = { position: 'absolute', left: 128, top: 0, bottom: 0, width: 960, display: 'flex', flexDirection: 'column', justifyContent: 'center' } as const;
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      {lineOut > 0 ? (
        <div style={{ ...column, opacity: lineOut }}>
          <div style={{ ...text, ...riseStyle(lineIn) }}>And storing memories into media devices and creating visual layout is</div>
          <div style={{ ...text, color: COLOR.red, fontWeight: 500, marginTop: 8, ...riseStyle(redIn) }}>expensive and tedious.</div>
        </div>
      ) : null}
      <div style={{ ...column, ...riseStyle(questionIn) }}>
        <div style={{ ...text, fontSize: 96 }}>
          What if there is a <span style={{ color: COLOR.teal, fontWeight: 500 }}>solution?</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1130, top: 170, width: 700, height: 740 }}>
        {DEVICES.map((device, index) => (
          <Device key={device.Icon.displayName ?? index} {...device} outAt={durationInFrames - OUT + (DEVICES.length - 1 - index)} />
        ))}
      </div>
    </AbsoluteFill>
  );
}
