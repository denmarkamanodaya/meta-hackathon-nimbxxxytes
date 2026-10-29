// usage: node sam.mjs out media(.mp4|.jpg) "prompt text" '{"metadata":"json"}'
import fs from 'node:fs';
import { decodeMaskToRaster, decodeMaskToSVGPath } from '../samlib/package/dist/index.js';
const [out, media, text, meta = '{}'] = process.argv.slice(2);
const key = fs.readFileSync('~/Projects/nimbytes/.env', 'utf8').match(/^MODEL_API_KEY=(.*)$/m)[1].replace(/"/g, '').trim();
const b64 = fs.readFileSync(media).toString('base64');
const part = media.endsWith('.mp4') ? { type: 'input_video', video_url: `data:video/mp4;base64,${b64}` } : { type: 'input_image', image_url: `data:image/jpeg;base64,${b64}` };
const body = { model: 'sam-3.1', stream: false, metadata: { include_confidence: 'true', ...JSON.parse(meta) }, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }, part] }] };
const t = Date.now();
const r = await fetch('https://api.meta.ai/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const j = await r.json();
const ms = Date.now() - t;
fs.writeFileSync(out + '.json', JSON.stringify(j, null, 1));
if (!r.ok) { console.log(out, 'HTTP', r.status, JSON.stringify(j).slice(0, 500)); process.exit(1); }
const textOut = (j.output || []).flatMap((o) => o.content || []).map((c) => c.text || '').join('');
const lines = textOut.split('\n').filter(Boolean);
const re = /(\d+)<\|box;([^|]*)\|><\|mask;([^|]*)\|>/g;
const frames = [];
for (const line of lines) {
  const f = +line.match(/^<(\d+)f>/)[1];
  for (const m of line.matchAll(re)) {
    const box = Object.fromEntries(m[2].split(';').map((kv) => kv.split('=')));
    const mk = m[3].split(';').find((s) => s.startsWith('data=')).slice(5);
    const [H, W] = mk.split(',').map(Number);
    const payload = mk.slice(mk.indexOf(',', mk.indexOf(',') + 1) + 1);
    const mask = { encoding: payload[0] === '!' ? 'one_bit' : 'lossless', width: W, height: H, payload };
    const raster = decodeMaskToRaster(mask);
    const on = raster.reduce((a, b) => a + b, 0);
    const path = decodeMaskToSVGPath(mask);
    frames.push({ f, id: +m[1], box, H, W, enc: mask.encoding, fill: (on / (W * H)).toFixed(2), pathLen: path.length, payloadLen: payload.length });
    if (frames.length === 1) { fs.writeFileSync(out + '_mask0.raw', Buffer.from(raster.map((v) => v * 255))); fs.writeFileSync(out + '_mask0.meta', JSON.stringify({ W, H, box })); }
  }
}
console.log(out, `${ms}ms`, 'usage', JSON.stringify(j.usage), 'lines', lines.length, 'records', frames.length);
for (const x of frames.slice(0, 4)) console.log(' ', JSON.stringify(x));
const ids = [...new Set(frames.map((x) => x.id))];
console.log('  ids', ids.join(','), 'frames', [...new Set(frames.map((x) => x.f))].sort((a, b) => a - b).join(','));
