// NimbytesHook: one scene on the white page, with its voice-over (British female). "It recalls
// memories based on your media," then "built with accessibility features for people.", each line
// zoom-fading in as it is spoken, the key words in teal.
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import { useZoomFade } from '../components/motion';
import { lineAt, placeLines } from '../components/voTiming';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';
import generated from './vo.generated.json' with { type: 'json' };
import lines from './vo-lines.json' with { type: 'json' };

const PLACED = placeLines(lines, generated, { min: 4, lead: 0.15, gap: 0.15, tail: 0.6 });

/** The hook's length in frames, at 30 fps: as long as its lines need, at least 4 s. */
export const HOOK_FRAMES = PLACED.durationInFrames;

export function Hook() {
  const line = { fontFamily: ROBOTO, fontWeight: 300, fontSize: 68, lineHeight: 1.2, color: COLOR.ink, textAlign: 'center', whiteSpace: 'nowrap' } as const;
  const key = { color: COLOR.teal, fontWeight: 500 } as const;
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center', padding: '0 160px' }}>
      <div style={{ ...line, ...useZoomFade(lineAt(PLACED.lines, 0).from - 2) }}>
        It <span style={key}>recalls memories</span> based on your media,
      </div>
      <div style={{ ...line, marginTop: 24, ...useZoomFade(lineAt(PLACED.lines, 1).from - 2) }}>
        built with <span style={key}>accessibility features</span> for people.
      </div>
      {PLACED.lines.map((spoken) => (
        <Sequence key={spoken.id} from={spoken.from} durationInFrames={spoken.durationInFrames}>
          <Audio src={staticFile(`audio/hook-vo/${spoken.id}.wav`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
