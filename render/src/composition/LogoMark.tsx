// The nimbytes mark: a cloud holding a 3×3 grid of bytes (filled and outlined squares) on a
// rounded tile. One source for the geometry: the PWA header and passcode screen import this
// component, the end card draws it, and the PWA's tokens test checks public/icons/icon.svg
// against these numbers.

/** Where the cloud and its bytes sit in the 64×64 tile: the group's SVG transform. */
export const LOGO_OFFSET = 'translate(-2.5 4)';
/** The byte grid's extra shift inside the cloud, so it sits in the cloud's visual middle. */
export const LOGO_BYTES_OFFSET = 'translate(1.5 0)';
/** Cloud outline in the 64×64 tile, before `LOGO_OFFSET`. */
export const LOGO_CLOUD_PATH = 'M16 42H50A11 11 0 0 0 50 20A15 15 0 0 0 21.5 16A13.5 13.5 0 0 0 16 42Z';
/** The four filled bytes: [x, y], 4.8 square, radius 1.2. */
export const LOGO_FILLED: readonly (readonly [number, number])[] = [
  [30.6, 20.4],
  [23.9, 27.1],
  [30.6, 27.1],
  [36.1, 33.8],
];
/** The five outlined bytes: [x, y], 3.6 square, radius 0.9, 1.2 stroke. */
export const LOGO_OUTLINED: readonly (readonly [number, number])[] = [
  [24.5, 21],
  [36.7, 21],
  [36.7, 27.7],
  [24.5, 34.4],
  [31.2, 34.4],
];

/** The mark's colours in rendered video, where the PWA tokens are not loaded. They equal the
 *  PWA's --accent (tile and bytes) and --color-surface (cloud); its tokens test fails if they drift. */
export const LOGO_VIDEO_COLOURS = { tile: '#0B6E85', cloud: '#FFFFFF', bytes: '#0B6E85' } as const;

/** Props for `LogoMark`. */
export interface LogoMarkProps {
  /** Rendered width and height, px. */
  size: number;
  /** Tile, cloud and byte colours (CSS colours; the PWA passes its tokens). */
  tile: string;
  cloud: string;
  bytes: string;
  className?: string;
}

/**
 * The mark as an inline SVG; decorative (aria-hidden), the name sits beside it.
 * @param props - See `LogoMarkProps`.
 * @returns The SVG.
 */
export function LogoMark({ size, tile, cloud, bytes, className }: LogoMarkProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill={tile} />
      <g transform={LOGO_OFFSET}>
        <path d={LOGO_CLOUD_PATH} fill={cloud} />
        <g transform={LOGO_BYTES_OFFSET}>
          <g fill={bytes}>
            {LOGO_FILLED.map(([x, y]) => (
              <rect key={`f${String(x)}-${String(y)}`} x={x} y={y} width="4.8" height="4.8" rx="1.2" />
            ))}
          </g>
          <g fill="none" stroke={bytes} strokeWidth="1.2">
            {LOGO_OUTLINED.map(([x, y]) => (
              <rect key={`o${String(x)}-${String(y)}`} x={x} y={y} width="3.6" height="3.6" rx="0.9" />
            ))}
          </g>
        </g>
      </g>
    </svg>
  );
}
