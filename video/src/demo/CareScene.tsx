// Demo scene 3 (timed to its voice line): the deck's "done by hand" slide over the blurred carer photo. Left: the
// headline and two lines (what memory therapy uses; everything found, sorted and printed by hand).
// Right: three printed photos dropping onto a pile, the front one captioned by hand.
import { BookOpen, Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { riseStyle, useEnter } from '../components/motion';
import { HANDWRITING, ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import { lineOf, type DemoSceneProps } from './timeline';

/** When the text starts rising in, in frames. */
const START = 2;

/** The carer photo, blurred and washed into the white page from the first frame, with a slow push-in. */
function Photo() {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, 60], [1.04, 1.08]);
  return (
    <AbsoluteFill>
      <Img src={staticFile('demo/carer.jpg')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${String(scale)})`, filter: 'blur(14px)' }} />
      <AbsoluteFill style={{ background: COLOR.white, opacity: 0.72 }} />
    </AbsoluteFill>
  );
}

/** One line with its icon on the left, rising in at `delay`. */
function Point({ delay, icon, children }: { delay: number; icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', ...riseStyle(useEnter(delay)) }}>
      <div style={{ flexShrink: 0, marginTop: 2 }}>{icon}</div>
      <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 36, lineHeight: 1.4, color: COLOR.ink }}>{children}</div>
    </div>
  );
}

/** A printed photo with a white border, dropping onto the pile at `delay` and settling at `rotate`. */
function Print({ src, left, top, width, rotate, delay, caption }: { src: string; left: number; top: number; width: number; rotate: number; delay: number; caption?: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drop = spring({ frame: frame - delay, fps, durationInFrames: 12, config: { damping: 200 } });
  const pad = 20;
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        padding: `${String(pad)}px ${String(pad)}px ${String(caption === undefined ? 80 : 96)}px`,
        background: COLOR.white,
        border: `1px solid ${COLOR.cardBorder}`,
        borderRadius: 8,
        boxShadow: '0 16px 36px rgba(13, 27, 30, 0.18)',
        opacity: drop,
        transform: `translateY(${String((1 - drop) * -60)}px) rotate(${String(rotate + (1 - drop) * rotate * 1.5)}deg) scale(${String(1.08 - 0.08 * drop)})`,
      }}
    >
      <Img src={staticFile(src)} style={{ display: 'block', width: width - pad * 2, height: width - pad * 2 - 10, objectFit: 'cover', borderRadius: 4 }} />
      {caption === undefined ? null : (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 28, textAlign: 'center', fontFamily: HANDWRITING, fontWeight: 400, fontSize: 42, lineHeight: 1, color: COLOR.ink }}>{caption}</div>
      )}
    </div>
  );
}

export function CareScene({ scene }: DemoSceneProps) {
  // Timed to the voice: the first point on "Photos, story books, videos" (just under half way in).
  const line = lineOf(scene, 0);
  const firstPoint = line.from + Math.round(line.durationInFrames * 0.45) - 4;
  const icon = { size: 56, strokeWidth: 1.5 } as const;
  const strong = { fontWeight: 500 } as const;
  return (
    <AbsoluteFill style={{ background: COLOR.white }}>
      <Photo />
      <div style={{ position: 'absolute', left: 128, right: 128, top: 0, bottom: 150, display: 'flex', alignItems: 'center', gap: 96 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 40 }}>
          <div style={{ fontFamily: ROBOTO, fontWeight: 300, fontSize: 96, lineHeight: 1.05, color: COLOR.ink, ...riseStyle(useEnter(START)) }}>
            Memory care is still <span style={{ color: COLOR.red, fontWeight: 500 }}>done by hand.</span>
          </div>
          <Point delay={firstPoint} icon={<BookOpen {...icon} color={COLOR.teal} />}>
            Memory therapy uses <span style={strong}>photos, videos, objects and music</span>, often turned into a <span style={strong}>life‑story book</span>.
          </Point>
          <Point delay={firstPoint + 14} icon={<Search {...icon} color={COLOR.red} />}>
            Every photo and clip is <span style={{ ...strong, color: COLOR.red }}>found, sorted and printed by hand.</span>
          </Point>
        </div>
        <div style={{ position: 'relative', width: 700, height: 720, flexShrink: 0 }}>
          <Print src="demo/album-mother-child.jpg" left={40} top={60} width={330} rotate={-8} delay={START + 4} />
          <Print src="demo/album-family-lake.jpg" left={330} top={20} width={330} rotate={6} delay={START + 9} />
          <Print src="demo/album-wedding.jpg" left={180} top={290} width={340} rotate={-2} delay={START + 14} caption="“Ana’s wedding, 1998”" />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 128, bottom: 48, width: 1664, fontFamily: ROBOTO, fontWeight: 300, fontSize: 22, lineHeight: 1.4, color: COLOR.inkSoft, opacity: useEnter(firstPoint + 22) }}>
        Source: Cochrane review “Reminiscence therapy for dementia” (2018): photographs, videos, objects and music as prompts, often producing a life‑story book.
        <br />
        Photos (CC0, via Unsplash and Wikimedia Commons): Tanja Heffner; Andre Hunter; Scott Webb.
      </div>
    </AbsoluteFill>
  );
}
