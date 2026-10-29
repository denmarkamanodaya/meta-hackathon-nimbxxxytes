// One PNG per scene into out/stills/ for quick review, each at 70% of its length.
import { mkdirSync } from 'node:fs';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { TIMELINE } from '../src/timeline.ts';

const root = new URL('..', import.meta.url).pathname;
const out = `${root}out/stills`;
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: `${root}src/index.ts` });
const port = 3150;
const composition = await selectComposition({ serveUrl, id: 'NimbytesPromo', port });
for (const [index, scene] of TIMELINE.entries()) {
  const frame = scene.from + Math.floor(scene.durationInFrames * 0.7);
  const name = `${String(index).padStart(2, '0')}-${scene.id}`;
  await renderStill({ composition, serveUrl, frame, port, output: `${out}/${name}.png` });
  console.log(`${name}.png (frame ${String(frame)})`);
}
