// The problem half: the hook (our own glasses footage, then "Storage Almost Full"), storage price,
// creators, dementia, care by hand, the bridge line and "What if we could help?".
import { BookOpen, Clock, Users } from 'lucide-react';
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Counter } from '../components/Counter';
import { Headline } from '../components/Headline';
import { useEnter, riseStyle, countUp } from '../components/motion';
import { Pill } from '../components/Pill';
import { ARCHIVO, INTER } from '../fonts';
import { COLOR, NIGHT } from '../theme';
import { at, During, Glass, HEAD, Source, type SceneProps } from './parts';

/** The hook's glasses clips: portrait POV first, then landscape. */
const POV = [
  { clip: 'broll/dog.mp4', w: 330, h: 440, x: 120, y: 420, rot: -4 },
  { clip: 'broll/kangaroo.mp4', w: 330, h: 440, x: 500, y: 360, rot: 2 },
  { clip: 'broll/supercars.mp4', w: 330, h: 440, x: 880, y: 430, rot: -2 },
  { clip: 'broll/concert.mp4', w: 520, h: 292, x: 1260, y: 330, rot: 3 },
  { clip: 'broll/temple.mp4', w: 520, h: 292, x: 1300, y: 660, rot: -3 },
] as const;

function PovCard({ card, index, deleteAt }: { card: (typeof POV)[number]; index: number; deleteAt: number }) {
  const frame = useCurrentFrame();
  const enter = useEnter(6 + index * 6);
  const myDelete = deleteAt + index * 7;
  const gone = interpolate(frame, [myDelete, myDelete + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
  const drift = Math.sin((frame + index * 40) / 50) * 8;
  return (
    <div
      style={{
        position: 'absolute',
        left: card.x,
        top: card.y + drift + (1 - enter) * 80,
        width: card.w,
        height: card.h,
        borderRadius: 22,
        overflow: 'hidden',
        transform: `rotate(${String(card.rot)}deg) scale(${String(1 - gone * 0.6)})`,
        opacity: enter * (1 - gone),
        filter: `grayscale(${String(gone)})`,
        boxShadow: '0 30px 70px rgba(0,0,0,0.55)',
        border: '2px solid rgba(255,255,255,0.12)',
      }}
    >
      <OffthreadVideo src={staticFile(card.clip)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', left: 14, top: 14 }}>
        <Pill background="rgba(0,0,0,0.55)" color="#fff" size={18} delay={10 + index * 6}>
          <span style={{ width: 10, height: 10, borderRadius: 5, background: '#ff4d4d' }} />
          REC
        </Pill>
      </div>
    </div>
  );
}

function StorageAlert({ from }: { from: number }) {
  const frame = useCurrentFrame();
  const slide = interpolate(frame, [from, from + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const tap = from + 40;
  const isTapped = frame >= tap;
  const leave = interpolate(frame, [tap + 10, tap + 22], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (slide <= 0 || leave <= 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: 960 - 330,
        top: 330 + (1 - slide) * -300,
        width: 660,
        opacity: slide * leave,
        background: 'rgba(30,30,32,0.94)',
        borderRadius: 34,
        overflow: 'hidden',
        fontFamily: INTER,
        color: '#fff',
        boxShadow: '0 40px 120px rgba(0,0,0,0.7)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div style={{ padding: '38px 44px 30px', textAlign: 'center' }}>
        <div style={{ fontSize: 36, fontWeight: 700 }}>Storage Almost Full</div>
        <div style={{ fontSize: 26, marginTop: 10, color: '#aab' }}>Free up space to keep recording.</div>
      </div>
      <div style={{ display: 'flex', borderTop: '1px solid rgba(255,255,255,0.12)', fontSize: 30 }}>
        <div style={{ flex: 1, padding: 26, textAlign: 'center', color: '#5aa9ff' }}>Not Now</div>
        <div style={{ flex: 1, padding: 26, textAlign: 'center', color: '#ff5a5a', fontWeight: 700, borderLeft: '1px solid rgba(255,255,255,0.12)', background: isTapped ? 'rgba(255,255,255,0.12)' : 'transparent' }}>
          Delete
        </div>
      </div>
    </div>
  );
}

export function HookScene({ scene }: SceneProps) {
  const second = at(scene, 1);
  return (
    <Backdrop>
      <During from={0} to={second}>
        <div style={HEAD}>
          <Headline first="We film" second="everything." size={110} delay={4} />
        </div>
      </During>
      <During from={second}>
        <div style={HEAD}>
          <Headline first="Then we" second="delete it." size={110} secondColor={NIGHT.red} />
        </div>
      </During>
      {POV.map((card, index) => (
        <PovCard key={card.clip} card={card} index={index} deleteAt={second + 52} />
      ))}
      <StorageAlert from={second + 4} />
    </Backdrop>
  );
}

/** Storage price: "3×" counting up, five quarterly bars rising red. */
export function PriceScene() {
  const frame = useCurrentFrame();
  const bars = [100, 135, 234, 263, 309];
  const labels = ["Q4 '25", 'Q1', 'Q2', 'Q3', "Q4 '26"];
  return (
    <Backdrop tint="#5a1d14">
      <div style={HEAD}>
        <Headline first="Storage got" second="3× pricier." size={110} secondColor={NIGHT.red} />
      </div>
      <div style={{ position: 'absolute', left: 120, top: 470 }}>
        <Counter from={1} to={3} size={260} color={NIGHT.red} delay={14} duration={50} format={(v) => (v >= 2.995 ? '3×' : `${v.toFixed(1)}×`)} />
        <div style={{ fontFamily: INTER, fontSize: 36, color: NIGHT.textSoft, marginTop: 18, ...riseStyle(useEnter(30)) }}>in one year. AI data centres buy first.</div>
      </div>
      <div style={{ position: 'absolute', right: 140, bottom: 210, display: 'flex', alignItems: 'flex-end', gap: 30 }}>
        {bars.map((value, index) => {
          const h = (value / 309) * 460 * spring({ frame: frame - 20 - index * 8, fps: 30, durationInFrames: 26, config: { damping: 12, mass: 0.7 } });
          return (
            <div key={labels[index]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 96, height: h, borderRadius: '14px 14px 4px 4px', background: COLOR.priceBars[index], boxShadow: index === 4 ? `0 0 50px ${NIGHT.red}88` : 'none' }} />
              <div style={{ fontFamily: INTER, fontSize: 24, fontWeight: 600, color: NIGHT.textSoft, opacity: Math.min(1, h / 40) }}>{labels[index]}</div>
            </div>
          );
        })}
      </div>
      <Source>Flash memory (NAND) contract prices. Source: TrendForce quarterly releases, Jan–Sep 2026, compounded (2.9–3.3×).</Source>
    </Backdrop>
  );
}

/** Creators: three glass stats. */
export function CreatorsScene() {
  const stats = [
    { to: 165, f: (v: number) => `+${String(Math.round(v))}M`, line: 'new creators in two years', strong: '303M worldwide', color: NIGHT.accent },
    { to: 3, f: (v: number) => `${String(Math.round(v))}M+`, line: 'creators earn on YouTube', strong: 'Up 50% since 2021', color: NIGHT.accent },
    { to: 480, f: (v: number) => `$${String(Math.round(v))}B`, line: 'creator economy by 2027', strong: 'Nearly double 2023', color: NIGHT.red },
  ];
  return (
    <Backdrop glowAt="top-right">
      <div style={HEAD}>
        <Headline first="More creators." second="More footage." size={110} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 470, display: 'flex', gap: 36 }}>
        {stats.map((stat, index) => (
          <Glass key={stat.line} delay={16 + index * 8} style={{ flex: 1 }}>
            <Counter from={0} to={stat.to} size={120} color={stat.color} delay={18 + index * 8} format={stat.f} />
            <div style={{ fontFamily: INTER, fontSize: 30, color: NIGHT.text, marginTop: 20 }}>{stat.line}</div>
            <div style={{ fontFamily: INTER, fontSize: 26, fontWeight: 700, color: NIGHT.textSoft, marginTop: 6 }}>{stat.strong}</div>
          </Glass>
        ))}
      </div>
      <Source>Sources: Adobe "Future of Creativity" (Aug 2022); YouTube Blog, Partner Program update (Aug 2026) and The Daily Upside (Aug 2021); Goldman Sachs Research (Apr 2023): $250B → $480B.</Source>
    </Backdrop>
  );
}

/** Dementia: 57M, then 139M by 2050, then "No cure." */
export function DementiaScene({ scene }: SceneProps) {
  const frame = useCurrentFrame();
  const second = at(scene, 1);
  const grow = countUp(frame, 0, 1, second, 24);
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 120, top: 150 }}>
        <Counter from={0} to={57} size={300} color={NIGHT.accent} delay={8} duration={40} format={(v) => `${String(Math.round(v))}M`} />
        <div style={{ fontFamily: ARCHIVO, fontWeight: 700, fontSize: 64, letterSpacing: -2, color: NIGHT.text, marginTop: 10, ...riseStyle(useEnter(18)) }}>people living with dementia.</div>
      </div>
      <During from={second}>
        <div style={{ position: 'absolute', left: 120, top: 620 }}>
          <Counter from={57} to={139} size={130} color={NIGHT.red} delay={second} duration={30} format={(v) => `${String(Math.round(v))}M by 2050.`} />
        </div>
      </During>
      <div style={{ position: 'absolute', right: 160, bottom: 220, display: 'flex', alignItems: 'flex-end', gap: 48 }}>
        {[
          { label: '2021', h: 205, c: COLOR.tealPale, p: countUp(frame, 0, 1, 14, 20) },
          { label: '2050', h: 500, c: NIGHT.red, p: grow },
        ].map((bar) => (
          <div key={bar.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 150, height: bar.h * bar.p, borderRadius: '16px 16px 4px 4px', background: bar.c }} />
            <div style={{ fontFamily: INTER, fontSize: 26, fontWeight: 600, color: NIGHT.textSoft, opacity: bar.p }}>{bar.label}</div>
          </div>
        ))}
      </div>
      <During from={second + 50}>
        <div style={{ position: 'absolute', left: 120, top: 790, fontFamily: ARCHIVO, fontWeight: 800, fontSize: 96, letterSpacing: -3, color: NIGHT.red, ...riseStyle(useEnter(second + 50)) }}>No cure.</div>
      </During>
      <Source>Sources: WHO Dementia fact sheet (Oct 2026); Alzheimer's Disease International (139M by 2050).</Source>
    </Backdrop>
  );
}

/** Care by hand: three glass cards. */
export function CareScene() {
  const cards = [
    { Icon: BookOpen, title: 'Photo albums', body: 'Memory work runs on photos, videos and life-story books families make themselves.' },
    { Icon: Clock, title: '5 hours a day', body: 'of unpaid care and supervision from each family carer.' },
    { Icon: Users, title: '$1.3 trillion', body: 'a year, and half of it is unpaid family care.' },
  ];
  return (
    <Backdrop>
      <div style={HEAD}>
        <Headline first="Memory care is" second="done by hand." size={110} secondColor={NIGHT.red} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 480, display: 'flex', gap: 36 }}>
        {cards.map((card, index) => (
          <Glass key={card.title} delay={16 + index * 8} style={{ flex: 1 }}>
            <card.Icon size={56} color={index === 2 ? NIGHT.red : NIGHT.accent} strokeWidth={2} />
            <div style={{ fontFamily: ARCHIVO, fontWeight: 800, fontSize: 52, letterSpacing: -2, color: NIGHT.text, marginTop: 18 }}>{card.title}</div>
            <div style={{ fontFamily: INTER, fontSize: 28, lineHeight: 1.4, color: NIGHT.textSoft, marginTop: 10 }}>{card.body}</div>
          </Glass>
        ))}
      </div>
      <Source>Sources: Cochrane review "Reminiscence therapy for dementia" (2018); WHO Dementia fact sheet (Oct 2026): US$1.3T (2019), ~50% informal care, ~5 h/day.</Source>
    </Backdrop>
  );
}

/** The bridge: a family memory fading to grey behind the line. */
export function BridgeScene({ scene }: SceneProps) {
  const frame = useCurrentFrame();
  const fade = interpolate(frame, [0, scene.durationInFrames], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ opacity: 0.55 * (1 - fade * 0.8), filter: `grayscale(${String(0.3 + fade * 0.7)}) blur(${String(fade * 6)}px)`, transform: `scale(${String(1.05 + fade * 0.08)})` }}>
        <OffthreadVideo src={staticFile('broll/birthday-party.mp4')} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.2) 0%, rgba(0,0,0,0.85) 75%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
        <Headline first="We're deleting the very memories" second="they're losing." size={92} align="center" delay={at(scene, 0)} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** What if: one line on a teal flash. */
export function WhatIfScene() {
  const frame = useCurrentFrame();
  const flash = interpolate(frame, [0, 10], [1, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: COLOR.teal }}>
      <AbsoluteFill style={{ background: '#fff', opacity: flash * 0.5 }} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 60 }}>
        <Headline first="What if we" second="could help?" size={170} align="center" delay={4} secondColor={COLOR.yellow} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
