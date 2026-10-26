// Renders the PWA PNG icons from the SVG sources with rsvg-convert (brew install librsvg).
// Run after editing public/icons/*.svg: npm run icons
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../public/icons/', import.meta.url));

const outputs = [
  { source: 'icon.svg', name: 'icon-192.png', size: 192 },
  { source: 'icon.svg', name: 'icon-512.png', size: 512 },
  { source: 'icon-maskable.svg', name: 'maskable-192.png', size: 192 },
  { source: 'icon-maskable.svg', name: 'maskable-512.png', size: 512 },
  { source: 'icon-maskable.svg', name: 'apple-touch-icon.png', size: 180 },
];

for (const { source, name, size } of outputs) {
  const args = ['-w', String(size), '-h', String(size), '-o', dir + name, dir + source];
  execFileSync('rsvg-convert', args, { stdio: 'inherit' });
  console.log(`wrote public/icons/${name} (${String(size)} px)`);
}
