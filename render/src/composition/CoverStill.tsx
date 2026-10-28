// The CoverStill composition: the cover picture full-bleed (optionally blurred) with the short
// title over it in the brand font, and optionally a cut-out subject standing in front of the
// title. The renderer draws it to the JPEG that is published as the cover.
import { AbsoluteFill, Img } from 'remotion';
import { backgroundBlurPx, titleFontSize, titlePlacement, titleWeight, type CoverStillProps } from './cover.ts';
import { cutoutPlacement } from './cutout.ts';
import { CutoutLayer } from './CutoutLayer.tsx';
import { useBrandFonts } from './fonts.ts';

/**
 * Draws a titled cover from its props.
 * @param props - Validated `CoverStillProps`.
 * @returns The still.
 */
export function CoverStill({ image_url, width, height, title, theme, background_blur, cutout }: CoverStillProps) {
  useBrandFonts();
  // Blurred, the picture is drawn a little larger so the soft edge falls outside the cover.
  const background =
    background_blur === true ? { filter: `blur(${String(backgroundBlurPx(width))}px)`, transform: 'scale(1.1)' } : {};
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000', overflow: 'hidden' }}>
      <Img src={image_url} style={{ width: '100%', height: '100%', objectFit: 'cover', ...background }} />
      <div
        style={{
          position: 'absolute',
          ...titlePlacement(title.position, width, height),
          fontFamily: theme.font,
          fontSize: titleFontSize(title.text, width),
          fontWeight: titleWeight(theme.font),
          letterSpacing: '-0.02em',
          lineHeight: 1.02,
          textTransform: 'uppercase',
          color: '#ffffff',
          textShadow: '0 2px 12px rgb(0 0 0 / 55%)',
          overflowWrap: 'break-word',
        }}
      >
        {title.text}
      </div>
      {cutout !== undefined && <CutoutLayer source={cutout} placement={cutoutPlacement(cutout.box, { width, height })} />}
    </AbsoluteFill>
  );
}
