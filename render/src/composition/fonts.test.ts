import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_FILES } from './fonts.ts';

const here = (path: string) => new URL(path, import.meta.url);

describe('brand fonts', () => {
  it('are the PWA files, byte for byte (one source: web/public/fonts)', () => {
    for (const f of FONT_FILES) {
      const ours = readFileSync(here(`../../public/${f.file}`));
      const web = readFileSync(here(`../../../web/public/${f.file}`));
      expect(ours.equals(web), f.file).toBe(true);
    }
  });

  it('are the families the API brand themes put first in their font stacks', () => {
    const brand = readFileSync(here('../../../api/crates/core/src/domain/brand.rs'), 'utf8');
    const stacks = [...brand.matchAll(/_FONT: &str =\s*"([^"]+)"/g)].map((m) => m[1] ?? '');
    const firsts = stacks.map((s) => (s.split(',')[0] ?? '').trim().replace(/'/g, ''));
    expect(firsts).toEqual(FONT_FILES.map((f) => f.family));
  });
});
