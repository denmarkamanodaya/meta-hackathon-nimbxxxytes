// Measures real renders: NimbytesShort with OffthreadVideo pulling a local 720p proxy (preview)
// and the full-size original (final) over HTTP, as in production. Local tool, not a test.
// Usage: npm run measure (expects fixtures-local/proxy-971.mp4 and original-971.mp4).
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import { COMPOSITION_ID } from '../src/composition/id.ts';
import type { ShortProps } from '../src/composition/schema.ts';
import { outputSize, type Quality } from '../src/frames.ts';
import { ENCODING } from '../src/remotion-render.ts';

const root = new URL('../', import.meta.url).pathname;
const media = join(root, 'fixtures-local');
const outDir = process.env.OUT_DIR ?? join(root, 'out');

const server = createServer((req, res) => {
  const file = join(media, (req.url ?? '/').split('?')[0] ?? '');
  const size = statSync(file).size;
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${String(start)}-${String(end)}/${String(size)}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Content-Type': 'video/mp4' });
  createReadStream(file).pipe(res);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = typeof address === 'object' && address !== null ? `http://127.0.0.1:${String(address.port)}` : '';

const phrase = (start: number, words: string[]) => ({
  start_s: start,
  end_s: start + words.length * 0.4,
  text: words.join(' '),
  words: words.map((text, i) => ({ text, at_s: start + i * 0.4 })),
});

function props(src: string): ShortProps {
  return {
    aspect: '4:5',
    fps: 30,
    clips: [
      { segment_id: 'a', src_url: `${base}/${src}`, in_s: 0.5, out_s: 4.5, punch_in: 1, subject: 'opening', captions: [phrase(0.8, ['first', 'light', 'on', 'the', 'street'])] },
      { segment_id: 'b', src_url: `${base}/${src}`, in_s: 5, out_s: 8.5, punch_in: 1.15, subject: null, captions: [phrase(5.4, ['keep', 'walking', 'north'])] },
      { segment_id: 'c', src_url: `${base}/${src}`, in_s: 9, out_s: 12.5, punch_in: 1, subject: 'the turn', captions: [phrase(9.6, ['and', 'here', 'we', 'are'])] },
      { segment_id: 'd', src_url: `${base}/${src}`, in_s: 13, out_s: 15.5, punch_in: 1.1, subject: null, captions: [] },
    ],
    post: { caption: 'Slow mornings', hashtags: ['#pov', '#morning'] },
    end_card_s: 1,
    theme: { accent: '#22d3ee', font: "Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif" },
  };
}

await ensureBrowser();
const t0 = Date.now();
const serveUrl = await bundle({ entryPoint: join(root, 'src/index.ts') });
console.log(`bundle ${String((Date.now() - t0) / 1000)} s`);

for (const [quality, src] of [['preview', 'proxy-971.mp4'], ['final', 'original-971.mp4']] as const satisfies readonly (readonly [Quality, string])[]) {
  const inputProps: Record<string, unknown> = props(src);
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });
  const outputLocation = join(outDir, `measure-${quality}.mp4`);
  const started = Date.now();
  await renderMedia({ composition: { ...composition, ...outputSize('4:5', quality) }, serveUrl, codec: 'h264', inputProps, outputLocation, ...ENCODING[quality] });
  const seconds = (Date.now() - started) / 1000;
  console.log(`${quality}: ${String(composition.durationInFrames / 30)} s of video in ${String(seconds)} s, ${String(statSync(outputLocation).size)} bytes`);
}
server.close();
