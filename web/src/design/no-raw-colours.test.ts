// Every colour comes from tokens.css: no hex colour literal anywhere else in src/ (styles,
// components, hooks, services). Tests are left out: they may name a value to check a token.
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['/src/**/*.{css,ts,tsx}', '!/src/**/*.test.{ts,tsx}', '!/src/design/tokens.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const HEX = /#[0-9a-f]{3,8}\b/gi;

describe('raw colours outside tokens.css', () => {
  it('reads the sources (the glob is not empty, CSS included)', () => {
    const paths = Object.keys(sources);

    expect(paths.length).toBeGreaterThan(100);
    expect(paths).toContain('/src/design/base.css');
    expect(sources['/src/components/desktop/MacSidebar.css']).toContain('.mac-sidebar');
  });

  it('finds no hex colour', () => {
    const found = Object.entries(sources).flatMap(([path, text]) =>
      [...text.matchAll(HEX)].map((match) => `${path}: ${match[0]}`),
    );

    expect(found).toEqual([]);
  });
});
