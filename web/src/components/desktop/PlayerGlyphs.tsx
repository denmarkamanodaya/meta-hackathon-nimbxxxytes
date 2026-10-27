// The Mac clip player's own control glyphs (redesign v2, V3): ±10 s, frame steps, volume,
// captions, loop, picture in picture and full screen. Only the player draws these, so they live
// beside it rather than in the shared icon set. Decorative: each button carries its own label.
import './PlayerGlyphs.css';

/** The glyphs. */
export type PlayerGlyphName = 'back10' | 'forward10' | 'frame-back' | 'frame-forward' | 'volume' | 'muted' | 'captions' | 'loop' | 'pip' | 'fullscreen';

const PATHS: Readonly<Record<Exclude<PlayerGlyphName, 'back10' | 'forward10'>, string>> = {
  'frame-back': 'M18 5v14M14 5 5 12l9 7z',
  'frame-forward': 'M6 5v14M10 5l9 7-9 7z',
  volume: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14',
  muted: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  captions: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3',
  loop: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  pip: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM13 12h5a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z',
  fullscreen: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
};

/** The jump arrows: a circular arrow and "10" inside. */
const JUMP = {
  back10: { arc: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', x: 12.5 },
  forward10: { arc: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', x: 11.5 },
} as const;

/**
 * One glyph, drawn in the current text colour.
 * @param props - The glyph and its size class (`sm` 16 px, `md` 18 px).
 * @returns The SVG.
 */
export function PlayerGlyph({ name, size = 'sm' }: { name: PlayerGlyphName; size?: 'sm' | 'md' }) {
  const className = `player-glyph player-glyph--${size}`;
  if (name === 'back10' || name === 'forward10') {
    const jump = JUMP[name];
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d={jump.arc} />
        <text x={jump.x} y={15.5} fontSize={7.5} textAnchor="middle" fill="currentColor" stroke="none">
          10
        </text>
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
