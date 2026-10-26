// Renderer entry: reads env once, bundles the composition, and serves POST /render on the
// compose network (never published to the internet).
import { createServer, type IncomingMessage } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser } from '@remotion/renderer';
import { createRemotionRender, createUpload, removeFile } from './remotion-render.ts';
import { createRenderService } from './render-service.ts';

const port = Number(process.env.PORT ?? '3001');
const timeoutMs = Number(process.env.RENDER_TIMEOUT_MS ?? '180000');
if (!Number.isInteger(port) || !Number.isFinite(timeoutMs)) throw new Error('PORT / RENDER_TIMEOUT_MS invalid');

const MAX_BODY_BYTES = 5 * 1024 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) reject(new Error('Body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? null : (JSON.parse(text) as unknown));
      } catch {
        resolve(undefined); // Recovers: invalid JSON fails schema validation with a 400.
      }
    });
    req.on('error', reject);
  });
}

await ensureBrowser();
const outDir = join(tmpdir(), 'nimbytes-render');
await mkdir(outDir, { recursive: true });
const serveUrl = await bundle({ entryPoint: new URL('./index.ts', import.meta.url).pathname });
const service = createRenderService({
  render: createRemotionRender({ serveUrl, outDir, timeoutMs }),
  upload: createUpload(),
  remove: removeFile,
});

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://renderer').pathname;
  readJson(req)
    .then((body) => service.handle(req.method ?? 'GET', path, body))
    .catch((thrown: unknown) => ({
      status: 413,
      body: { error: { code: 'VALIDATION_FAILED', message: thrown instanceof Error ? thrown.message : 'Bad body' } },
    }))
    .then((reply) => {
      res.writeHead(reply.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply.body));
    }, () => undefined);
}).listen(port, () => {
  console.log(JSON.stringify({ msg: 'renderer listening', port }));
});
