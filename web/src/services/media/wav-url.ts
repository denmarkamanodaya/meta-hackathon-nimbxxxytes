// A small 16-bit mono WAV as a data URL, built in memory: silence (to unlock the phone's audio
// element inside a tap, so an answer that arrives later may play) or a soft tone (mock mode's
// stand-in voice). No file is fetched or committed.

/** What to build. */
export interface WavSpec {
  seconds: number;
  /** Tone pitch, Hz; 0 for silence. */
  hz: number;
  sampleRate: number;
  /** Peak level, 0–1. */
  level: number;
}

/**
 * The WAV's bytes: a 44-byte header, then the samples.
 * @param spec - Length, pitch, rate and level.
 * @returns The file.
 */
export function wavBytes(spec: WavSpec): Uint8Array {
  const samples = Math.max(1, Math.round(spec.seconds * spec.sampleRate));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, spec.sampleRate, true);
  view.setUint32(28, spec.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  const peak = Math.round(Math.min(1, Math.max(0, spec.level)) * 32767);
  for (let n = 0; n < samples; n += 1) {
    const value = spec.hz === 0 ? 0 : Math.round(peak * Math.sin((2 * Math.PI * spec.hz * n) / spec.sampleRate));
    view.setInt16(44 + n * 2, value, true);
  }
  return bytes;
}

/**
 * The WAV as a `data:audio/wav;base64,…` URL.
 * @param spec - Length, pitch, rate and level.
 * @returns The URL.
 */
export function wavDataUrl(spec: WavSpec): string {
  const bytes = wavBytes(spec);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

/** A tenth of a second of silence, for unlocking playback inside a tap. */
export const SILENT_WAV_URL = wavDataUrl({ seconds: 0.1, hz: 0, sampleRate: 8000, level: 0 });
