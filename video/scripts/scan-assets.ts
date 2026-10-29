// Lists the media under public/ (screens, live captures, b-roll, voice-over, music) with their
// lengths from ffprobe, into src/assets.generated.json, so a scene can draw a labelled placeholder
// for a missing file. Runs before `dev`, `render` and `stills`.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const PUBLIC = new URL('../public/', import.meta.url).pathname;
const OUT = new URL('../src/assets.generated.json', import.meta.url).pathname;
const MEDIA = /\.(mp4|mov|wav|mp3|m4a|png)$/i;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : MEDIA.test(name) ? [path] : [];
  });
}

function seconds(path: string): number | null {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
    const value = Number(out.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null; // Recovers: an unreadable file still counts as present, with no length.
  }
}

const files: Record<string, number | null> = {};
for (const path of walk(PUBLIC)) files[relative(PUBLIC, path)] = seconds(path);
writeFileSync(OUT, `${JSON.stringify({ files }, null, 2)}\n`);

console.log(`assets: ${String(Object.keys(files).length)} media file(s) in public/`);
