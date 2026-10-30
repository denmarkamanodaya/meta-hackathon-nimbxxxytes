// NimbytesOutro: the close, on the white page. First the six Meta models nimbytes uses (from the
// promo's models scene: same list, figures and source note), with the promo's voice ("Six Meta
// models do the work. Muse Spark understands, SAM sees, Perception Encoder remembers, and more.");
// then the lockup and "Your AI-powered filesystem" ("nimbytes. Your AI-powered filesystem."), with a
// note bottom right: works best with hands-free capture devices like Ray-Ban Meta glasses.
// Voice: public/audio/vo/models-1, models-2, close-1, close-2 (the promo's own recordings).
import { AbsoluteFill, Audio, Sequence, Series, staticFile, useCurrentFrame } from 'remotion';
import { Headline } from '../components/Headline';
import { Logo } from '../components/Logo';
import { META_MODELS, META_MODELS_SOURCE } from '../components/metaModels';
import { riseStyle, useEnter, useZoomFade } from '../components/motion';
import { placeLines } from '../components/voTiming';
import { DISPLAY, ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import generated from '../vo.generated.json' with { type: 'json' };

const line = (id: string, text: string) => ({ id, text });
const MODELS_VO = placeLines([line('models-1', 'Six Meta models do the work.'), line('models-2', 'Muse Spark understands, SAM sees, Perception Encoder remembers, and more.')], generated, { min: 6, lead: 0.4, gap: 0.4, tail: 1.2 });
const CLOSE_VO = placeLines([line('close-1', 'nimbytes.'), line('close-2', 'Your AI-powered filesystem.')], generated, { min: 3.5, lead: 0.5, gap: 0.3, tail: 1.6 });

/** The outro's length in frames. */
export const OUTRO_FRAMES = MODELS_VO.durationInFrames + CLOSE_VO.durationInFrames;

function Voice({ lines }: { lines: readonly { id: string; from: number; durationInFrames: number }[] }) {
  return (
    <>
      {lines.map((l) => (
        <Sequence key={l.id} from={l.from} durationInFrames={l.durationInFrames}>
          <Audio src={staticFile(`audio/vo/${l.id}.wav`)} />
        </Sequence>
      ))}
    </>
  );
}

/** One model card: white, thin border, rising in at its turn. */
function ModelCard({ model, delay }: { model: (typeof META_MODELS)[number]; delay: number }) {
  return (
    <div style={{ padding: 30, borderRadius: 22, background: COLOR.white, border: `1px solid ${COLOR.cardBorder}`, boxShadow: '0 20px 50px rgba(13, 27, 30, 0.08)', ...riseStyle(useEnter(delay)) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <model.Icon size={38} color={COLOR.teal} strokeWidth={1.8} />
        <span style={{ fontFamily: ROBOTO, fontWeight: 500, fontSize: 21, letterSpacing: 3, textTransform: 'uppercase', color: COLOR.teal }}>{model.role}</span>
      </div>
      <div style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: 38, letterSpacing: -0.5, color: COLOR.ink, marginTop: 14 }}>{model.name}</div>
      <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 24, lineHeight: 1.4, color: COLOR.inkSoft, marginTop: 8 }}>{model.line}</div>
    </div>
  );
}

function ModelsScene() {
  const first = MODELS_VO.lines[0]?.from ?? 0;
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <div style={{ position: 'absolute', left: 120, top: 90 }}>
        <Headline first="Six Meta models." second="Every one doing real work." size={84} delay={first} firstColor={COLOR.ink} secondColor={COLOR.teal} />
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, top: 340, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }}>
        {META_MODELS.map((model, index) => (
          <ModelCard key={model.name} model={model} delay={first + 14 + index * 5} />
        ))}
      </div>
      <div style={{ position: 'absolute', left: 120, right: 120, bottom: 52, fontFamily: ROBOTO, fontWeight: 300, fontSize: 21, lineHeight: 1.4, color: COLOR.inkSoft, opacity: useEnter(first + 40) }}>{META_MODELS_SOURCE}</div>
      <Voice lines={MODELS_VO.lines} />
    </AbsoluteFill>
  );
}

/** The closing note's grey (owner's pick). */
const NOTE_GREY = '#686d78';

function CloseScene() {
  const frame = useCurrentFrame();
  const tagAt = CLOSE_VO.lines[1]?.from ?? 0;
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', ...useZoomFade(2), scale: String(1 + frame * 0.0005) }}>
        <Logo size={140} color={COLOR.ink} />
        <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 36, color: COLOR.inkSoft, marginTop: 24, ...riseStyle(useEnter(tagAt)) }}>Your AI-powered filesystem</div>
      </div>
      <div style={{ position: 'absolute', right: 64, bottom: 52, fontFamily: ROBOTO, fontWeight: 400, fontSize: 24, color: NOTE_GREY, opacity: useEnter(tagAt) }}>
        Works best with hands-free capture devices like Ray-Ban Meta glasses.
      </div>
      <Voice lines={CLOSE_VO.lines} />
    </AbsoluteFill>
  );
}

export function Outro() {
  return (
    <Series>
      <Series.Sequence durationInFrames={MODELS_VO.durationInFrames}>
        <ModelsScene />
      </Series.Sequence>
      <Series.Sequence durationInFrames={CLOSE_VO.durationInFrames}>
        <CloseScene />
      </Series.Sequence>
    </Series>
  );
}
