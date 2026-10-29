// The problem opener (about 20 s): one figure per beat, counting up, with its source; the last beat
// is care by hand. Calm motion only: numbers count, bars rise slowly, lines rise gently.
import { BookOpen, ChartColumn, Clock, Play, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { AbsoluteFill, spring, useCurrentFrame } from 'remotion';
import { wordsOf } from '../captions';
import { Headline } from '../components/Headline';
import { Backdrop } from '../components/Backdrop';
import { countUp, riseStyle, useEnter } from '../components/motion';
import { DISPLAY, INTER } from '../fonts';
import { COLOR, NIGHT } from '../theme';
import { Source, type SceneProps } from './parts';

/** A big thin number counting up from `from` to `to`, starting `delay` frames in. */
function Figure({ from, to, format, color, delay = 4, duration = 40, size = 280 }: { from: number; to: number; format: (v: number) => string; color: string; delay?: number; duration?: number; size?: number }) {
  const frame = useCurrentFrame();
  const enter = useEnter(delay);
  return (
    <div style={{ fontFamily: DISPLAY, fontWeight: 200, fontSize: size, letterSpacing: -size / 40, lineHeight: 0.9, color, ...riseStyle(enter) }}>
      {format(countUp(frame, from, to, delay, duration))}
    </div>
  );
}

/** A short line under a figure, rising in gently. */
function Line({ children, delay, color = NIGHT.text, size = 52 }: { children: string; delay: number; color?: string; size?: number }) {
  return <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: size, color, marginTop: 18, ...riseStyle(useEnter(delay)) }}>{children}</div>;
}

/** The title, as on the deck: the two problems, with Storage and Memory picked out. */
export function ProblemTitleScene() {
  return (
    <Backdrop glowAt="center">
      <div style={{ position: 'absolute', left: 140, right: 140, top: 300 }}>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.accent, marginBottom: 30, ...riseStyle(useEnter(2)) }}>THE PROBLEM</div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 200, fontSize: 104, lineHeight: 1.12, color: NIGHT.text, ...riseStyle(useEnter(6)) }}>
          Artificial Intelligence <span style={{ color: COLOR.yellow }}>Storage</span>
        </div>
        <div style={{ fontFamily: DISPLAY, fontWeight: 200, fontSize: 104, lineHeight: 1.12, color: NIGHT.text, ...riseStyle(useEnter(16)) }}>
          &amp; Human Intelligence <span style={{ color: COLOR.yellow }}>Memory</span> Problem
        </div>
      </div>
    </Backdrop>
  );
}

/** Beat 1, as on the deck: AI · Storage, 3× counting up, and the five quarterly bars rising. */
export function ProblemPriceScene() {
  const frame = useCurrentFrame();
  const bars = [100, 135, 234, 263, 309];
  const labels = ["Q4 '25", 'Q1', 'Q2', 'Q3', "Q4 '26"];
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 140, top: 200 }}>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.red, marginBottom: 22, ...riseStyle(useEnter(2)) }}>AI · STORAGE</div>
        <Figure from={1} to={3} color={NIGHT.red} format={(v) => (v >= 2.995 ? '3×' : `${v.toFixed(1)}×`)} duration={50} />
        <Line delay={14}>the price of storage, in one year.</Line>
        <Line delay={30} color={NIGHT.textSoft}>AI data centres buy first.</Line>
      </div>
      <div style={{ position: 'absolute', right: 160, bottom: 200, display: 'flex', alignItems: 'flex-end', gap: 26 }}>
        {bars.map((value, index) => {
          const grow = spring({ frame: frame - 10 - index * 7, fps: 30, durationInFrames: 40, config: { damping: 200 } });
          return (
            <div key={labels[index]} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 96, height: (value / 309) * 480 * grow, borderRadius: '12px 12px 4px 4px', background: COLOR.priceBars[index] }} />
              <div style={{ fontFamily: INTER, fontWeight: 300, fontSize: 24, color: index === 4 ? NIGHT.text : NIGHT.textSoft, opacity: grow }}>{labels[index]}</div>
            </div>
          );
        })}
      </div>
      <Source>Flash memory (NAND) contract prices. Source: TrendForce quarterly releases, Jan–Sep 2026, compounded (2.9–3.3×).</Source>
    </Backdrop>
  );
}

/** Beat 2: since the pandemic, as on the deck: three figures that rise in as the voice speaks. */
export function ProblemCreatorsScene({ scene }: SceneProps) {
  const len = scene.durationInFrames;
  const at = [Math.round(len * 0.08), Math.round(len * 0.32), Math.round(len * 0.52)];
  const title = { fontFamily: DISPLAY, fontWeight: 300, fontSize: 64, lineHeight: 1.05, marginTop: 26 } as const;
  const body = { fontFamily: DISPLAY, fontWeight: 300, fontSize: 30, color: NIGHT.textSoft, lineHeight: 1.4, marginTop: 18 } as const;
  return (
    <Backdrop glowAt="top-right">
      <div style={{ position: 'absolute', left: 140, top: 96 }}>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.red, marginBottom: 22, ...riseStyle(useEnter(2)) }}>SINCE THE PANDEMIC</div>
        <Headline first="More creators. More footage." second="And it's not stopping." size={88} delay={4} />
      </div>
      <div style={{ position: 'absolute', left: 140, right: 140, top: 450, display: 'flex', gap: 40 }}>
        <CareCard at={at[0] ?? 0}>
          <Users size={64} strokeWidth={1.4} color={NIGHT.accent} />
          <div style={{ ...title, color: NIGHT.accent }}>
            <Count from={0} to={165} delay={(at[0] ?? 0) + 4} format={(v) => `+${String(Math.round(v))}M`} />
          </div>
          <div style={body}>new creators in two years. 303M worldwide.</div>
        </CareCard>
        <CareCard at={at[1] ?? 0}>
          <Play size={64} strokeWidth={1.4} color={NIGHT.accent} />
          <div style={{ ...title, color: NIGHT.accent }}>
            <Count from={0} to={3} delay={(at[1] ?? 0) + 4} format={(v) => `${String(Math.round(v))}M+`} />
          </div>
          <div style={body}>creators now earn on YouTube. Up 50% since 2021.</div>
        </CareCard>
        <CareCard at={at[2] ?? 0}>
          <ChartColumn size={64} strokeWidth={1.4} color={NIGHT.red} />
          <div style={{ ...title, color: NIGHT.red }}>
            <Count from={0} to={480} delay={(at[2] ?? 0) + 4} format={(v) => `$${String(Math.round(v))}B`} />
          </div>
          <div style={body}>creator economy by 2027. Nearly double 2023.</div>
        </CareCard>
      </div>
      <Source>Sources: Adobe "Future of Creativity" (Aug 2022); YouTube Blog, Partner Program update (Aug 2026) and The Daily Upside (Aug 2021); Goldman Sachs Research (Apr 2023): $250B → $480B.</Source>
    </Backdrop>
  );
}

/** Beat 3: human memory. 57M counts up; "No cure yet."; 2021 and 2050 bars, the second growing to 139M. */
export function ProblemMemoryScene({ scene }: SceneProps) {
  const frame = useCurrentFrame();
  const later = Math.round(scene.durationInFrames * 0.45);
  const bars = [
    { label: '2021', value: '57M', h: 205, color: COLOR.tealPale, at: 10 },
    { label: '2050', value: '139M', h: 500, color: NIGHT.red, at: later },
  ];
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 140, top: 150 }}>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.red, marginBottom: 22, ...riseStyle(useEnter(2)) }}>HUMAN · MEMORY</div>
        <Figure from={0} to={57} color={NIGHT.accent} format={(v) => `${String(Math.round(v))}M`} />
        <Line delay={14}>people living with dementia.</Line>
        <Line delay={later + 20} color={NIGHT.red}>No cure yet.</Line>
      </div>
      <div style={{ position: 'absolute', right: 180, bottom: 200, display: 'flex', alignItems: 'flex-end', gap: 56 }}>
        {bars.map((bar) => {
          const grow = spring({ frame: frame - bar.at, fps: 30, durationInFrames: 45, config: { damping: 200 } });
          return (
            <div key={bar.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 44, color: bar.color, opacity: grow }}>{bar.value}</div>
              <div style={{ width: 150, height: bar.h * grow, borderRadius: '14px 14px 4px 4px', background: bar.color }} />
              <div style={{ fontFamily: INTER, fontWeight: 300, fontSize: 24, color: NIGHT.textSoft, opacity: grow }}>{bar.label}</div>
            </div>
          );
        })}
      </div>
      <Source>Sources: WHO Dementia fact sheet (Oct 2026); Alzheimer's Disease International (139M by 2050).</Source>
    </Backdrop>
  );
}

/** A number counting up inside a line of text (same size and baseline as its line). */
function Count({ from, to, delay, format }: { from: number; to: number; delay: number; format: (v: number) => string }) {
  const frame = useCurrentFrame();
  return <>{format(countUp(frame, from, to, delay, 24))}</>;
}

/** A figure card for the care beat: it rises in when the voice reaches its words. */
function CareCard({ at, children }: { at: number; children: ReactNode }) {
  const enter = useEnter(at);
  return (
    <div
      style={{
        flex: 1,
        height: 470,
        padding: '44px 48px',
        borderRadius: 28,
        background: NIGHT.glass,
        border: `1px solid ${NIGHT.glassBorder}`,
        display: 'flex',
        flexDirection: 'column',
        ...riseStyle(enter),
      }}
    >
      {children}
    </div>
  );
}

/**
 * Beat 4: care today, as on the deck. "Memory care is still done by hand.", then three cards that
 * rise in as the voice reaches them: photo albums, 5 hours a day, $1.3 trillion.
 */
export function ProblemCareScene({ scene }: SceneProps) {
  const line = scene.lines[0];
  const words = line === undefined ? [] : wordsOf(line);
  const when = (word: string) => (words.find((w) => w.text.toLowerCase().startsWith(word))?.from ?? scene.from) - scene.from;
  const albumsAt = when('photo') - 4;
  const hoursAt = when('five') - 4;
  const costAt = hoursAt + 22;
  const title = { fontFamily: DISPLAY, fontWeight: 300, fontSize: 58, color: NIGHT.text, lineHeight: 1.05, marginTop: 26 } as const;
  const body = { fontFamily: DISPLAY, fontWeight: 300, fontSize: 30, color: NIGHT.textSoft, lineHeight: 1.4, marginTop: 18 } as const;
  return (
    <Backdrop>
      <div style={{ position: 'absolute', left: 140, top: 96 }}>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.red, marginBottom: 22, ...riseStyle(useEnter(2)) }}>CARE TODAY</div>
        <Headline first="Memory care is still" second="done by hand." size={92} delay={4} secondColor={NIGHT.red} />
      </div>
      <div style={{ position: 'absolute', left: 140, right: 140, top: 450, display: 'flex', gap: 40 }}>
        <CareCard at={albumsAt}>
          <BookOpen size={64} strokeWidth={1.4} color={NIGHT.accent} />
          <div>
            <div style={title}>Photo albums</div>
            <div style={body}>Memory therapy runs on photos, videos and life-story books families make themselves.</div>
          </div>
        </CareCard>
        <CareCard at={hoursAt}>
          <Clock size={64} strokeWidth={1.4} color={NIGHT.accent} />
          <div>
            <div style={title}>
              <Count from={0} to={5} delay={hoursAt + 4} format={(v) => `${String(Math.round(v))} hours a day`} />
            </div>
            <div style={body}>of unpaid care and supervision from each family carer.</div>
          </div>
        </CareCard>
        <CareCard at={costAt}>
          <Users size={64} strokeWidth={1.4} color={NIGHT.red} />
          <div>
            <div style={title}>
              <span style={{ color: NIGHT.red }}>
                <Count from={0} to={1.3} delay={costAt + 4} format={(v) => `$${v.toFixed(1)} trillion`} />
              </span>
            </div>
            <div style={body}>a year, and half of it is unpaid family care.</div>
          </div>
        </CareCard>
      </div>
      <Source>Sources: Cochrane review "Reminiscence therapy for dementia" (2018): photographs, videos, objects and life-story books; WHO Dementia fact sheet (Oct 2026): US$1.3T (2019), ~50% informal care, ~5 h/day.</Source>
    </Backdrop>
  );
}

/** A small source line under a column's figures. */
function ColumnSource({ children, delay }: { children: string; delay: number }) {
  return <div style={{ fontFamily: INTER, fontWeight: 300, fontSize: 20, lineHeight: 1.45, color: NIGHT.textSoft, marginTop: 30, maxWidth: 680, ...riseStyle(useEnter(delay)) }}>{children}</div>;
}

/** The two problems on one screen: Human · Memory 57M first (left), then AI · Storage 3× (right). */
export function ProblemBothScene({ scene }: SceneProps) {
  const right = Math.round(scene.durationInFrames * 0.5);
  const eyebrow = { fontFamily: INTER, fontWeight: 400, fontSize: 26, letterSpacing: 6, color: NIGHT.red, marginBottom: 22 } as const;
  return (
    <Backdrop glowAt="center">
      <div style={{ position: 'absolute', left: 140, right: 140, top: 170, display: 'flex', gap: 120 }}>
        <div style={{ flex: 1 }}>
          <div style={{ ...eyebrow, ...riseStyle(useEnter(2)) }}>HUMAN · MEMORY</div>
          <Figure from={0} to={57} color={NIGHT.accent} delay={4} duration={36} format={(v) => `${String(Math.round(v))}M`} />
          <Line delay={12} size={42}>people living with dementia.</Line>
          <Line delay={30} color={NIGHT.red} size={42}>No cure yet.</Line>
          <Line delay={44} color={NIGHT.textSoft} size={42}>Memory care is still done by hand.</Line>
          <ColumnSource delay={48}>Sources: WHO Dementia fact sheet (Oct 2026); Cochrane review (2018): photos, videos and life-story books families make themselves.</ColumnSource>
        </div>
        <div style={{ width: 1, background: NIGHT.glassBorder, opacity: 0.8 }} />
        <div style={{ flex: 1 }}>
          <div style={{ ...eyebrow, ...riseStyle(useEnter(right)) }}>AI · STORAGE</div>
          <Figure from={1} to={3} color={NIGHT.red} delay={right + 2} duration={36} format={(v) => (v >= 2.995 ? '3×' : `${v.toFixed(1)}×`)} />
          <Line delay={right + 10} size={42}>the price of storage, in one year.</Line>
          <Line delay={right + 24} color={NIGHT.textSoft} size={42}>AI data centres buy it first.</Line>
          <ColumnSource delay={right + 28}>Source: TrendForce NAND contract prices, Jan–Sep 2026, compounded (2.9–3.3×).</ColumnSource>
        </div>
      </div>
    </Backdrop>
  );
}

/** Beat 5: the turn. "What if your footage could remember for you…", a pause, "…and show you how?" */
export function ProblemWhatIfScene({ scene }: SceneProps) {
  const frame = useCurrentFrame();
  const second = (scene.lines[1]?.from ?? scene.from) - scene.from;
  const settle = 1 + (frame / scene.durationInFrames) * 0.025;
  return (
    <Backdrop glowAt="center">
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${String(settle)})` }}>
        <Headline first="What if your footage could remember for you…" second="…and show you how?" size={92} align="center" delay={6} secondDelay={second} />
      </AbsoluteFill>
    </Backdrop>
  );
}
