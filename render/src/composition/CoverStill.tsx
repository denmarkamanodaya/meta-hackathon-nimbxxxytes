// The CoverStill composition: the cover picture full-bleed with the short title over it, in the
// brand font. The renderer draws it to the JPEG that is published as the cover.
import { AbsoluteFill, Img } from 'remotion';
import { titleFontSize, titlePlacement, titleWeight, type CoverStillProps } from './cover.ts';
import { useBrandFonts } from './fonts.ts';

/**
 * Draws a titled cover from its props.
 * @param props - Validated `CoverStillProps`.
 * @returns The still.
 */
export function CoverStill({ image_url, width, height, title, theme }: CoverStillProps) {
  useBrandFonts();
  return (
    <AbsoluteFill style={{ backgroundColor: '#000000' }}>
      <Img src={image_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
    </AbsoluteFill>
  );
}
