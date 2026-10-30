// The close: six Meta models, the glasses roadmap (labelled as roadmap the whole time, no logo
// drawn) and the closing line with the lockup.
import type { ReactNode } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Backdrop } from '../components/Backdrop';
import { Headline } from '../components/Headline';
import { Logo } from '../components/Logo';
import { META_MODELS, META_MODELS_SOURCE } from '../components/metaModels';
import { riseStyle, useEnter } from '../components/motion';
import { Pill } from '../components/Pill';
import { ARCHIVO, INTER } from '../fonts';
import { COLOR, NIGHT } from '../theme';
import { Glass, HEAD, Source } from './parts';


export function ModelsScene() {
  const frame = useCurrentFrame();
  return (
    <Backdrop glowAt="center">
      <div style={HEAD}>
        <Headline first="Six Meta models." second="Every one doing real work." size={88} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 380, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28, transform: `perspective(2000px) rotateX(${String(6 - frame * 0.03)}deg) translateY(${String(-frame * 0.12)}px)` }}>
        {META_MODELS.map((m, index) => (
          <Glass key={m.name} delay={14 + index * 5} style={{ padding: 30 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <m.Icon size={40} color={NIGHT.accent} strokeWidth={2} />
              <span style={{ fontFamily: INTER, fontWeight: 400, fontSize: 22, letterSpacing: 3, textTransform: 'uppercase', color: NIGHT.accent }}>{m.role}</span>
            </div>
            <div style={{ fontFamily: ARCHIVO, fontWeight: 300, fontSize: 38, letterSpacing: -0.5, color: NIGHT.text, marginTop: 14 }}>{m.name}</div>
            <div style={{ fontFamily: INTER, fontSize: 24, lineHeight: 1.4, color: NIGHT.textSoft, marginTop: 8 }}>{m.line}</div>
          </Glass>
        ))}
      </div>
      <Source>{META_MODELS_SOURCE}</Source>
    </Backdrop>
  );
}

/** Appendix A icons (viewBox 0 0 100 100, stroke 5, round caps and joins). */
const ICONS: Record<'glasses' | 'cloud' | 'sparkles' | 'speaker', ReactNode> = {
  glasses: (
    <g stroke={COLOR.tealLight}>
      <rect x="8" y="44" width="32" height="24" rx="10" />
      <rect x="50" y="44" width="32" height="24" rx="10" />
      <path d="M40 51 Q45 46 50 51" />
      <path d="M8 50 L3 44" />
      <path d="M82 50 L87 44" />
      <path d="M74 14 Q82 24 74 34" />
      <path d="M84 8 Q96 24 84 40" />
    </g>
  ),
  cloud: (
    <g stroke={COLOR.tealLight}>
      <path d="M28 72 H72 A16 16 0 0 0 70 40 A22 22 0 0 0 28 44 A14 14 0 0 0 28 72 Z" />
      <path d="M50 64 V40" />
      <path d="M40 50 L50 40 L60 50" />
    </g>
  ),
  sparkles: (
    <g stroke="none">
      <path d="M42 20 Q46 48 74 52 Q46 56 42 84 Q38 56 10 52 Q38 48 42 20 Z" fill={COLOR.tealLight} />
      <path d="M78 8 Q80 22 94 24 Q80 26 78 40 Q76 26 62 24 Q76 22 78 8 Z" fill={COLOR.yellow} />
    </g>
  ),
  speaker: (
    <g stroke={COLOR.yellow}>
      <path d="M16 40 H30 L50 24 V76 L30 60 H16 Z" />
      <path d="M62 38 Q70 50 62 62" />
      <path d="M73 28 Q86 50 73 72" />
    </g>
  ),
};

const STEPS = [
  { icon: 'glasses', label: 'Say it', bubble: 'Hey, save this.', border: COLOR.tealLight },
  { icon: 'cloud', label: 'Saves itself', border: COLOR.tealLight },
  { icon: 'sparkles', label: 'Meta AI understands', border: COLOR.tealLight },
  { icon: 'speaker', label: 'Hear the answer', bubble: 'Find my keys.', border: COLOR.yellow },
] as const;

function Step({ step, delay }: { step: (typeof STEPS)[number]; delay: number }) {
  const enter = useEnter(delay);
  const bubble = useEnter(delay + 10);
  return (
    <div style={{ width: 320, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, ...riseStyle(enter) }}>
      <div style={{ height: 70 }}>
        {'bubble' in step && (
          <span style={{ display: 'inline-block', background: COLOR.yellow, color: COLOR.ink, fontFamily: INTER, fontWeight: 400, fontSize: 28, padding: '10px 22px', borderRadius: 24, ...riseStyle(bubble) }}>{`“${step.bubble}”`}</span>
        )}
      </div>
      <div style={{ width: 220, height: 220, borderRadius: 110, background: COLOR.darkCard, border: `4px solid ${step.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 50px ${step.border}44` }}>
        <svg viewBox="0 0 100 100" width={120} height={120} fill="none" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
          {ICONS[step.icon]}
        </svg>
      </div>
      <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 32, color: NIGHT.text }}>{step.label}</div>
    </div>
  );
}

export function GlassesScene() {
  const lock = useEnter(6);
  return (
    <Backdrop glowAt="center">
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 70 }}>
        <Pill background={COLOR.yellow} color={COLOR.ink}>
          AFTER THE HACKATHON
        </Pill>
        <div style={{ marginTop: 30, fontFamily: ARCHIVO, fontWeight: 400, fontSize: 92, letterSpacing: -3, ...riseStyle(lock) }}>
          <span style={{ color: NIGHT.accent }}>nimbytes</span>
          <span style={{ color: NIGHT.textSoft, margin: '0 26px' }}>×</span>
          <span style={{ color: NIGHT.text }}>Meta AI glasses</span>
        </div>
        <div style={{ fontFamily: INTER, fontWeight: 400, fontSize: 42, color: COLOR.yellow, marginTop: 6, ...riseStyle(lock) }}>One intelligent assistant you wear.</div>
        <div style={{ display: 'flex', alignItems: 'flex-start', marginTop: 30 }}>
          {STEPS.map((step, index) => (
            <Step key={step.label} step={step} delay={24 + index * 16} />
          ))}
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 26, textAlign: 'center', fontFamily: INTER, fontSize: 22, color: COLOR.roadmapFooter }}>
        Roadmap, not yet built: direct glasses capture depends on Meta's Wearables Device Access Toolkit.
      </div>
    </Backdrop>
  );
}

export function CloseScene() {
  const frame = useCurrentFrame();
  const logo = useEnter(4);
  return (
    <Backdrop glowAt="center">
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', opacity: logo, transform: `scale(${String(0.9 + 0.1 * logo + frame * 0.0006)})` }}>
        <Logo size={140} />
        <div style={{ fontFamily: INTER, fontWeight: 300, fontSize: 32, color: NIGHT.textSoft, marginTop: 22 }}>Your AI-powered filesystem</div>
      </AbsoluteFill>
    </Backdrop>
  );
}
