// The Mac dark theme's contrast table and the light rows added since (the warning colour), run against the values in tokens.css (the one source), so
// a token edit that breaks WCAG AA fails here. Ratios per WCAG 2.x relative luminance.
import { describe, expect, it } from 'vitest';
import tokens from './tokens.css?raw';

const DARK = ":root[data-theme='dark'], .theme-night {";

/** The custom properties declared in the block that starts at `opener` (no nested braces). */
function block(opener: string, from = 0): Map<string, string> {
  const start = tokens.indexOf(opener, from);
  if (start === -1) throw new Error(`block ${opener} not found`);
  const body = tokens.slice(start + opener.length, tokens.indexOf('}', start));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [String(m[1]), String(m[2]).trim()]));
}

const light = block(':root, .theme-night {');
const dark = block(`\n${DARK}`);
const highContrast = block(DARK, tokens.indexOf('prefers-contrast: more'));

/** A token's value through `layers` (first wins), following var() references. */
function resolve(name: string, layers: readonly Map<string, string>[]): string {
  const raw = layers.map((layer) => layer.get(name)).find((value) => value !== undefined);
  if (raw === undefined) throw new Error(`--${name} not defined`);
  const ref = /^var\(--([\w-]+)\)$/.exec(raw);
  return ref?.[1] === undefined ? raw : resolve(ref[1], layers);
}

function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (match?.[1] === undefined) throw new Error(`not a #rrggbb colour: ${hex}`);
  const value = match[1];
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = parseInt(value.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const darkRatio = (fg: string, bg: string, layers = [dark, light]) => ratio(resolve(fg, layers), resolve(bg, layers));

/** The verified table: foreground, background, the ratio it was signed off at, the AA minimum. */
const TABLE: readonly [fg: string, bg: string, signedOff: number, need: number][] = [
  ['color-text-muted', 'color-bg', 7.79, 4.5],
  ['color-text-muted', 'color-raised', 6.45, 4.5],
  ['color-text-muted', 'color-menu', 6.13, 4.5],
  ['accent', 'color-bg', 10.09, 4.5],
  ['on-accent', 'accent', 11.31, 4.5],
  ['on-accent', 'color-success', 11.77, 4.5],
  ['color-success-text', 'color-bg', 11.51, 4.5],
  ['color-warning', 'color-bg', 9.84, 4.5],
  ['color-border-strong', 'color-bg', 4.49, 3],
];

/** Phase 29 (near-copies, same moments): the badge and box text on their own grounds. */
const SIMILAR_PAIRS: readonly [fg: string, bg: string][] = [
  ['on-copy-badge', 'color-copy-badge'],
  ['color-copy-title', 'color-copy-box'],
  ['color-copy-body', 'color-copy-box'],
  ['color-copy-note', 'color-copy-box'],
  ['on-angles-badge', 'color-angles-badge'],
  ['color-angles-body', 'color-angles-box'],
  ['color-angles-note', 'color-angles-box'],
  ['color-text', 'color-angles-row-on'],
  ['color-angles-note', 'color-angles-row-on'],
];

describe('dark theme contrast (WCAG AA)', () => {
  it.each(TABLE)('%s on %s is %f:1 and meets %f:1', (fg, bg, signedOff, need) => {
    const actual = darkRatio(fg, bg);

    expect(actual).toBeCloseTo(signedOff, 1);
    expect(actual).toBeGreaterThanOrEqual(need);
  });

  it('keeps the subtle border decorative: 1.45:1 on raised, under the 3:1 a boundary needs', () => {
    const actual = darkRatio('color-border', 'color-raised');

    expect(actual).toBeCloseTo(1.45, 1);
    expect(actual).toBeLessThan(3);
  });

  it.each([
    ['color-text', 'color-surface-2'],
    ['color-text-muted', 'color-surface'],
    ['accent-hover', 'color-raised'],
    ['on-accent', 'accent-hover'],
    ['color-danger', 'color-bg'],
    ['color-danger', 'color-surface'],
    ['color-danger', 'color-menu'],
    ['on-accent', 'color-danger'],
  ])('%s on %s passes 4.5:1 (values beyond the signed-off table)', (fg, bg) => {
    expect(darkRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SIMILAR_PAIRS)('%s on %s passes 4.5:1 (Phase 29 badges and boxes)', (fg, bg) => {
    expect(darkRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('Increase Contrast raises separators to the control border and muted text to #c8c8c8', () => {
    const layers = [highContrast, dark, light];

    expect(resolve('color-border', layers)).toBe(resolve('color-border-strong', layers));
    expect(resolve('color-text-muted', layers).toLowerCase()).toBe('#c8c8c8');
    expect(darkRatio('color-border', 'color-raised', layers)).toBeGreaterThanOrEqual(3);
    for (const bg of ['color-bg', 'color-raised', 'color-menu']) {
      expect(darkRatio('color-text-muted', bg, layers)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/** Light rows: foreground, background, the ratio it was signed off at (redesign 2026-10-27). */
const LIGHT_TABLE: readonly [fg: string, bg: string, signedOff: number][] = [
  ['color-warning', 'color-surface', 6.33],
  ['color-warning', 'color-bg', 5.78],
  ['color-warning', 'color-warning-subtle', 5.67],
];

describe('light theme contrast (WCAG AA)', () => {
  it.each(LIGHT_TABLE)('%s on %s is %f:1 and meets 4.5:1', (fg, bg, signedOff) => {
    const actual = ratio(resolve(fg, [light]), resolve(bg, [light]));

    expect(actual).toBeCloseTo(signedOff, 1);
    expect(actual).toBeGreaterThanOrEqual(4.5);
  });
});

describe('availability state aliases', () => {
  it.each([
    ['state-cloud', 'color-text-muted'],
    ['state-cached', 'accent'],
    ['state-kept', 'color-success'],
  ])('--%s is --%s in both themes, with no hue of its own', (alias, target) => {
    expect(light.get(alias)).toBe(`var(--${target})`);
    expect(dark.has(alias)).toBe(false);
    expect(resolve(alias, [dark, light])).toBe(resolve(target, [dark, light]));
  });
});

describe('dark theme token names', () => {
  it('redefines only names the light theme has', () => {
    const darkOnly = [...dark.keys()].filter((name) => !light.has(name));

    expect(darkOnly).toEqual([]);
  });

  it('gives dark a warning subtle of its own (a tint of the dark warning)', () => {
    expect(dark.get('color-warning-subtle')).toBe('rgb(255 169 77 / 14%)');
  });

  it('keeps the logo tile and cloud out of the dark block', () => {
    expect(dark.has('brand-tile')).toBe(false);
    expect(dark.has('brand-cloud')).toBe(false);
    expect(resolve('brand-tile', [light]).toLowerCase()).toBe('#0b6e85');
  });
});
