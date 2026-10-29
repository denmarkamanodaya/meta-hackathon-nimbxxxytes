import { describe, expect, it } from 'vitest';
import { SILENT_WAV_URL, wavBytes, wavDataUrl } from './wav-url';

describe('wavBytes', () => {
  it('writes a PCM header whose sizes match the sample count', () => {
    const bytes = wavBytes({ seconds: 0.5, hz: 440, sampleRate: 8000, level: 0.2 });
    const view = new DataView(bytes.buffer);
    const text = (at: number) => String.fromCharCode(...bytes.slice(at, at + 4));

    expect(text(0)).toBe('RIFF');
    expect(text(8)).toBe('WAVE');
    expect(text(36)).toBe('data');
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(40, true)).toBe(4000 * 2);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(bytes.length).toBe(44 + 8000);
  });

  it('is all zero samples for silence, and stays under the level for a tone', () => {
    const silent = wavBytes({ seconds: 0.01, hz: 0, sampleRate: 8000, level: 1 });
    expect(silent.slice(44).every((byte) => byte === 0)).toBe(true);
    const tone = new DataView(wavBytes({ seconds: 0.01, hz: 440, sampleRate: 8000, level: 0.5 }).buffer);
    const peak = Math.max(...Array.from({ length: 80 }, (_, n) => Math.abs(tone.getInt16(44 + n * 2, true))));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(16384);
  });
});

describe('wavDataUrl', () => {
  it('is a base64 audio/wav data URL', () => {
    expect(wavDataUrl({ seconds: 0.01, hz: 0, sampleRate: 8000, level: 0 })).toMatch(/^data:audio\/wav;base64,UklGR/);
    expect(SILENT_WAV_URL.startsWith('data:audio/wav;base64,')).toBe(true);
  });
});
