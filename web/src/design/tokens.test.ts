// Drift gate: index.html, the web manifest, the icon sources and the service worker repeat
// values from tokens.css and base.css, because none of them can read CSS custom properties.
// These tests fail when the copies drift.
import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import iconMaskableSvg from '../../public/icons/icon-maskable.svg?raw';
import iconSvg from '../../public/icons/icon.svg?raw';
import manifestText from '../../public/manifest.webmanifest?raw';
import serviceWorker from '../../public/sw.js?raw';
import renderSample from '../../../render/fixtures/props.sample.json';
import base from './base.css?raw';
import {
  LOGO_BYTES_OFFSET,
  LOGO_CLOUD_PATH,
  LOGO_FILLED,
  LOGO_OFFSET,
  LOGO_OUTLINED,
  LOGO_VIDEO_COLOURS,
} from '@nimbytes/logo';
import tokens from './tokens.css?raw';

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(tokens);
  if (match?.[1] === undefined) throw new Error(`token --${name} not found`);
  return match[1];
}

describe('theme colours outside tokens.css', () => {
  it('is light only (no dark theme block)', () => {
    expect(tokens).not.toContain('prefers-color-scheme: dark');
    expect(html).toContain('<meta name="color-scheme" content="light" />');
  });

  it('index.html theme-color matches --color-bg', () => {
    expect(html).toContain(`<meta name="theme-color" content="${token('color-bg')}" />`);
  });

  it('the manifest uses --accent as theme and --color-bg as background', () => {
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;

    expect(manifest.theme_color).toBe(token('accent'));
    expect(manifest.background_color).toBe(token('color-bg'));
  });

  it('has one video accent (the colour drawn in rendered shorts), and no second caption token', () => {
    expect(token('video-accent').toLowerCase()).toBe('#ffe58a');
    expect(tokens).not.toContain('--caption-highlight');
  });

  it('the render fixture draws shorts in --video-accent', () => {
    // Case-insensitive: the api compares hex colours without case too.
    expect(renderSample.theme.accent.toLowerCase()).toBe(token('video-accent').toLowerCase());
  });

  it('the icon sources draw the shared mark: tile and bytes in --accent, cloud in --color-surface', () => {
    for (const svg of [iconSvg, iconMaskableSvg]) {
      const lower = svg.toLowerCase();
      expect(svg).toContain(`<g transform="${LOGO_OFFSET}">`);
      expect(svg).toContain(`<g transform="${LOGO_BYTES_OFFSET}">`);
      expect(svg).toContain(`d="${LOGO_CLOUD_PATH}"`);
      for (const [x, y] of LOGO_FILLED) expect(svg).toContain(`<rect x="${String(x)}" y="${String(y)}" width="4.8"`);
      for (const [x, y] of LOGO_OUTLINED) expect(svg).toContain(`<rect x="${String(x)}" y="${String(y)}" width="3.6"`);
      expect(lower).toContain(`fill="${token('color-surface')}"`);
      expect(lower).toContain(`fill="${token('accent')}"`);
    }
  });

  it('the rendered end card draws the mark in the same colours as the app', () => {
    expect(LOGO_VIDEO_COLOURS.tile.toLowerCase()).toBe(token('accent'));
    expect(LOGO_VIDEO_COLOURS.cloud.toLowerCase()).toBe(token('color-surface'));
    expect(LOGO_VIDEO_COLOURS.bytes.toLowerCase()).toBe(token('accent'));
  });

  it('the maskable icon is a full-bleed square: no rounded tile', () => {
    expect(iconMaskableSvg.toLowerCase()).toContain(`<rect width="64" height="64" fill="${token('accent')}"/>`);
    expect(iconSvg.toLowerCase()).toContain(`<rect width="64" height="64" rx="14" fill="${token('accent')}"/>`);
  });
});

describe('self-hosted fonts', () => {
  const fontFiles = [...base.matchAll(/url\('(\/fonts\/[^']+\.woff2)'\)/g)].map((m) => m[1]);

  it('declares Bricolage Grotesque 700, Geist 400–600 and Geist Mono 500', () => {
    expect(base).toMatch(/font-family: 'Bricolage Grotesque';[^}]*font-weight: 700;/);
    expect(base).toMatch(/font-family: 'Geist';[^}]*font-weight: 400 600;/);
    expect(base).toMatch(/font-family: 'Geist Mono';[^}]*font-weight: 500;/);
    expect(fontFiles).toHaveLength(6);
  });

  it('precaches every font file in the service worker, and loads none from a CDN', () => {
    for (const file of fontFiles) expect(serviceWorker).toContain(`'${String(file)}'`);
    expect(html).not.toContain('fonts.googleapis.com');
    expect(base).not.toContain('fonts.googleapis.com');
  });
});
