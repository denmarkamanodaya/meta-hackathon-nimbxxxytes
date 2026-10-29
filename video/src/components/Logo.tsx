// The nimbytes lockup: the app's own mark (the same geometry the app and the shorts renderer use)
// and the name.
import { LogoMark, LOGO_VIDEO_COLOURS } from '../../../render/src/composition/LogoMark';
import { DISPLAY } from '../fonts';
import { NIGHT } from '../theme';

export function Logo({ size }: { size: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3 }}>
      <LogoMark size={size} {...LOGO_VIDEO_COLOURS} />
      <span style={{ fontFamily: DISPLAY, fontWeight: 300, fontSize: size * 0.82, letterSpacing: -size / 60, color: NIGHT.text }}>nimbytes</span>
    </div>
  );
}
