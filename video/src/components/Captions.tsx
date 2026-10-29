// Word-by-word captions at the foot of the frame: the words spoken so far in white, the word being
// spoken in the accent colour, the rest not yet shown; the app's own read-aloud voice in yellow after
// a speaker icon. Always on: this is an accessibility product.
import { Volume2 } from 'lucide-react';
import { useCurrentFrame } from 'remotion';
import { captionAt } from '../captions';
import { INTER } from '../fonts';
import { COLOR, NIGHT } from '../theme';

export function Captions() {
  const frame = useCurrentFrame();
  const caption = captionAt(frame);
  if (caption === undefined) return null;
  // The app's own read-aloud voice: yellow words after a speaker, so it reads as nimbytes speaking.
  const isDevice = caption.line.voice === 'device';
  return (
    <div style={{ position: 'absolute', left: 240, right: 240, bottom: 64, display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          columnGap: 12,
          rowGap: 4,
          maxWidth: 1300,
          fontFamily: INTER,
          fontWeight: 700,
          fontSize: 44,
          lineHeight: 1.25,
          textShadow: '0 2px 12px rgba(0,0,0,0.85)',
        }}
      >
        {isDevice && <Volume2 size={44} color={COLOR.yellow} strokeWidth={2.5} />}
        {caption.words.map((word, index) => {
          const isNow = frame >= word.from && frame < word.to;
          const isSaid = frame >= word.to;
          return (
            <span key={`${word.text}-${String(index)}`} style={{ display: 'inline-block', transform: `scale(${String(isNow ? 1.08 : 1)})`, color: isNow ? NIGHT.accent : isDevice ? COLOR.yellow : NIGHT.text, opacity: isNow || isSaid ? 1 : 0.28 }}>
              {word.text}
            </span>
          );
        })}
      </div>
    </div>
  );
}
