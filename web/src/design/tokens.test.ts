// Drift gate: index.html and the web manifest repeat theme colours from tokens.css, because
// neither can read CSS custom properties. These tests fail when the copies drift.
import { describe, expect, it } from 'vitest';
import html from '../../index.html?raw';
import iconMaskableSvg from '../../public/icons/icon-maskable.svg?raw';
import iconSvg from '../../public/icons/icon.svg?raw';
import manifestText from '../../public/manifest.webmanifest?raw';
import sampleProps from '../../../render/fixtures/props.sample.json';
import tokens from './tokens.css?raw';

const [lightBlock = '', darkBlock = ''] = tokens.split('@media (prefers-color-scheme: dark)');

function token(block: string, name: string): string {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(block);
  if (match?.[1] === undefined) throw new Error(`token --${name} not found`);
  return match[1];
}

describe('theme colours outside tokens.css', () => {
  it('index.html theme-color metas match the light and dark --color-bg', () => {
    expect(html).toContain(
      `content="${token(lightBlock, 'color-bg')}" media="(prefers-color-scheme: light)"`,
    );
    expect(html).toContain(
      `content="${token(darkBlock, 'color-bg')}" media="(prefers-color-scheme: dark)"`,
    );
  });

  it('the manifest uses the light --accent as theme and --color-bg as background', () => {
    const manifest = JSON.parse(manifestText) as Record<string, unknown>;

    expect(manifest.theme_color).toBe(token(lightBlock, 'accent'));
    expect(manifest.background_color).toBe(token(lightBlock, 'color-bg'));
  });

  it('the icon sources are drawn in the light --accent', () => {
    const accent = token(lightBlock, 'accent');

    expect(iconSvg).toContain(`fill="${accent}"`);
    expect(iconMaskableSvg).toContain(`fill="${accent}"`);
  });

  it('the video composition fixture uses the dark --accent (bright on footage)', () => {
    expect(sampleProps.theme.accent).toBe(token(darkBlock, 'accent'));
  });
});

