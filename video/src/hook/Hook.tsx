// NimbytesHook: one scene on the white page. "It recalls memories based on your media," then "it is
// built with accessibility features for people.", each zoom-fading in, the key words in teal.
import { AbsoluteFill } from 'remotion';
import { useZoomFade } from '../components/motion';
import { ROBOTO } from '../fonts';
import { COLOR } from '../theme';

/** The hook's length in frames, at 30 fps. */
export const HOOK_FRAMES = 120;

export function Hook() {
  const line = { fontFamily: ROBOTO, fontWeight: 300, fontSize: 68, lineHeight: 1.2, color: COLOR.ink, textAlign: 'center', whiteSpace: 'nowrap' } as const;
  const key = { color: COLOR.teal, fontWeight: 500 } as const;
  return (
    <AbsoluteFill style={{ background: COLOR.white, alignItems: 'center', justifyContent: 'center', padding: '0 160px' }}>
      <div style={{ ...line, ...useZoomFade(4) }}>
        It <span style={key}>recalls memories</span> based on your media,
      </div>
      <div style={{ ...line, marginTop: 24, ...useZoomFade(30) }}>
        it is built with <span style={key}>accessibility features</span> for people.
      </div>
    </AbsoluteFill>
  );
}
