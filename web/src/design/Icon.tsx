// Inline icons from the Mist design (24 px grid). Line icons stroke with currentColor; a few
// solid glyphs (play, pause) fill with it, and a line glyph may add a filled part (`fillD`).
import './Icon.css';

interface Glyph {
  d: string;
  /** Solid glyph (fill) instead of a line icon (stroke). */
  solid?: boolean;
  /** A filled part drawn over a line glyph (the half-full "on this Mac for a few minutes" disc). */
  fillD?: string;
}

const GLYPHS = {
  library: { d: 'M5 3h3.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15.5 3H19a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 15h14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2z' },
  search: { d: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5' },
  plus: { d: 'M12 5v14M5 12h14' },
  shorts: { d: 'M8 3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM10 9l5 3-5 3z' },
  people: { d: 'M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5M17 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM17 14.5c2.3 0 3.8 1.5 4.5 4' },
  account: { d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6' },
  back: { d: 'M15 5l-7 7 7 7' },
  forward: { d: 'M9 5l7 7-7 7' },
  arrow: { d: 'M5 12h14M13 6l6 6-6 6' },
  close: { d: 'M6 6l12 12M18 6 6 18' },
  check: { d: 'm5 12 5 5 9-10' },
  hide: { d: 'M3 3l18 18M10.6 6.1A9.5 9.5 0 0 1 12 6c5 0 8.5 4.5 9.5 6-.5.8-1.6 2.2-3.1 3.5M6.6 7.6C4.6 8.9 3.2 10.8 2.5 12c1 1.5 4.5 6 9.5 6 1.6 0 3-.4 4.3-1.1' },
  play: { d: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z', solid: true },
  pause: { d: 'M7 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM15 5h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', solid: true },
  cloud: { d: 'M7 19h10.5a4.5 4.5 0 0 0 .7-8.95A6.5 6.5 0 0 0 5.6 9.4 4.8 4.8 0 0 0 7 19z' },
  info: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01' },
  offline: { d: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.17-2.8M12.5 10a10 10 0 0 1 6.5 3M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M12 20h.01' },
  share: { d: 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7' },
  person: { d: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0' },
  /** Availability: on this Mac for a few minutes (half full). */
  half: { d: 'M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15z', fillD: 'M12 4.5a7.5 7.5 0 0 1 0 15z' },
  /** Availability: kept offline (down to this Mac). */
  keep: { d: 'M12 4v10M7.5 10l4.5 4.5 4.5-4.5M5 19.5h14' },
  clock: { d: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 8v4.2l2.8 1.8' },
  sparkle: { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z' },
  /** Redesign v2 (Mac): view switch, sections, right column and menus. */
  grid: { d: 'M4.5 3h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1 -1.5 1.5h-4a1.5 1.5 0 0 1 -1.5 -1.5v-4a1.5 1.5 0 0 1 1.5 -1.5zM15.5 3h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1 -1.5 1.5h-4a1.5 1.5 0 0 1 -1.5 -1.5v-4a1.5 1.5 0 0 1 1.5 -1.5zM4.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1 -1.5 1.5h-4a1.5 1.5 0 0 1 -1.5 -1.5v-4a1.5 1.5 0 0 1 1.5 -1.5zM15.5 14h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1 -1.5 1.5h-4a1.5 1.5 0 0 1 -1.5 -1.5v-4a1.5 1.5 0 0 1 1.5 -1.5z' },
  list: { d: 'M9 6h12M9 12h12M9 18h12M3.5 4.5h2a0.5 0.5 0 0 1 0.5 0.5v2a0.5 0.5 0 0 1 -0.5 0.5h-2a0.5 0.5 0 0 1 -0.5 -0.5v-2a0.5 0.5 0 0 1 0.5 -0.5zM3.5 10.5h2a0.5 0.5 0 0 1 0.5 0.5v2a0.5 0.5 0 0 1 -0.5 0.5h-2a0.5 0.5 0 0 1 -0.5 -0.5v-2a0.5 0.5 0 0 1 0.5 -0.5zM3.5 16.5h2a0.5 0.5 0 0 1 0.5 0.5v2a0.5 0.5 0 0 1 -0.5 0.5h-2a0.5 0.5 0 0 1 -0.5 -0.5v-2a0.5 0.5 0 0 1 0.5 -0.5z' },
  face: { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8M9 9.5h.01M15 9.5h.01' },
  /** Find this: a crosshair with a filled centre. */
  target: { d: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM12 2v4M12 18v4M2 12h4M18 12h4', fillD: 'M12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
  scissors: { d: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12' },
  folder: { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  reveal: { d: 'M14 3h7v7M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5' },
  more: { d: 'M5 12h.01M12 12h.01M19 12h.01' },
  gear: { d: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1' },
  upload: { d: 'M12 21V9M7 14l5-5 5 5M5 3h14' },
  'chevron-down': { d: 'm6 9 6 6 6-6' },
  'chevron-right': { d: 'm9 6 6 6-6 6' },
  /** Availability badge (redesign v2): kept offline. */
  'check-circle': { d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6' },
  film: { d: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 3v18M17 3v18M3 7.5h4M3 12h18M3 16.5h4M17 7.5h4M17 16.5h4' },
  /** Project key art: "New art". */
  refresh: { d: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5' },
  /** Mac Short page (V7): "Open in Final Cut Pro", an editable timeline. */
  guides: { d: 'M4 5h4v4H4zM4 15h4v4H4zM11 7h9M11 17h9' },
  timeline: { d: 'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM7 9v6M11 9v6M15 9v6' },
} as const satisfies Record<string, Glyph>;

/** Names of the icons this set draws. */
export type IconName = keyof typeof GLYPHS;

/** Props for `Icon`. */
export interface IconProps {
  /** Which glyph to draw. */
  name: IconName;
  /** `xs` 14, `sm` 16, `md` 20, default 24, `lg` 48 px; all from tokens. */
  size?: 'xs' | 'sm' | 'md' | 'default' | 'lg';
}

/**
 * Decorative SVG icon; hidden from assistive tech, so pair it with visible or sr-only text.
 * @param props - See `IconProps`.
 * @returns The SVG element.
 */
export function Icon({ name, size = 'default' }: IconProps) {
  const glyph: Glyph = GLYPHS[name];
  const isSolid = glyph.solid === true;
  return (
    <svg
      className={`icon icon--${size}`}
      viewBox="0 0 24 24"
      fill={isSolid ? 'currentColor' : 'none'}
      stroke={isSolid ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={glyph.d} />
      {glyph.fillD !== undefined && <path d={glyph.fillD} fill="currentColor" stroke="none" />}
    </svg>
  );
}
