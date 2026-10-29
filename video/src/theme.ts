// The demo's design tokens: the pitch deck's colours, type and layout, copied exactly from the
// build prompt (§3). Every scene and component reads them from here and nowhere else.

export const COLOR = {
  teal: '#0B6E85',
  tealLight: '#5FC3D9',
  tealPale: '#A9CCD4',
  yellow: '#FFE58A',
  red: '#B4432E',
  ink: '#0D1B1E',
  inkSoft: '#52646A',
  paper: '#F3F5F4',
  card: '#FFFFFF',
  cardBorder: '#D5DDDE',
  darkCard: '#16292E',
  disclaimer: '#D72E2E',
  /** The eyebrow and footer tint on teal (S01, S14). */
  onTeal: '#E2F1F4',
  /** S13's roadmap footer on ink. */
  roadmapFooter: '#8FA3A8',
  white: '#FFFFFF',
  /** S02's bars, Q4 '25 to Q4 '26: from teal-pale to red. */
  priceBars: ['#A9CCD4', '#E3A497', '#D06A55', '#C2543F', '#B4432E'],
} as const;

/** Page layout, in px at 1920×1080. */
export const LAYOUT = {
  width: 1920,
  height: 1080,
  side: 128,
  top: 128,
  footerBottom: 64,
  /** Caption distance from the bottom: plain, and lifted above a source footer. */
  captionBottom: 72,
  captionAboveFooter: 150,
} as const;

/** Motion: entrances, the scene crossfade and the stagger between items, in frames. */
export const MOTION = {
  enter: 12,
  crossfade: 10,
  stagger: 5,
} as const;

/** The promo's night palette: ink backgrounds with a teal glow, like the Mac app's Night theme. */
export const NIGHT = {
  bg: '#071214',
  bgDeep: '#030809',
  glow: '#0B6E85',
  glowSoft: 'rgba(95, 195, 217, 0.18)',
  text: '#FFFFFF',
  textSoft: '#A8BCC1',
  accent: '#5FC3D9',
  glass: 'rgba(22, 41, 46, 0.72)',
  glassBorder: 'rgba(95, 195, 217, 0.22)',
  window: '#121212',
  red: '#E06A55',
} as const;
