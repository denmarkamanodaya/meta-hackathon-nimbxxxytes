// Which device voice reads aloud (pure). English only: en-GB first, then en-AU, en-US, other en-*.
// A "Premium" or "Enhanced" voice beats a compact one, and the known natural voices (Serena, Kate,
// Martha, Stephanie, Karen, Samantha, Moira, Tessa) beat the rest; within a tier the language order
// decides, then an on-device voice beats a network one. Novelty voices (Albert, Bad News, Zarvox,
// the Fred family, …) are never picked.

/** What the rule needs from a voice (a `SpeechSynthesisVoice` fits). */
export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
}

/** Slightly slower than the default, for older listeners. */
export const SPEECH_RATE = 0.95;

const NATURAL = ['serena', 'kate', 'martha', 'stephanie', 'karen', 'samantha', 'moira', 'tessa'];

const NOVELTY = [
  'albert',
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'deranged',
  'fred',
  'good news',
  'hysterical',
  'jester',
  'junior',
  'kathy',
  'organ',
  'pipe organ',
  'princess',
  'ralph',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
];

const LANGS = ['en-gb', 'en-au', 'en-us'];

/** The name before any "(English (UK))" or "(Enhanced)", lower case. */
const baseName = (name: string): string => (name.toLowerCase().split('(')[0] ?? '').trim();

const firstWord = (name: string): string => baseName(name).split(' ')[0] ?? '';

/** Lower is better; null when the voice is never used. */
function rank(voice: VoiceInfo): number[] | null {
  const lang = voice.lang.toLowerCase().replace('_', '-');
  if (!lang.startsWith('en') || NOVELTY.includes(baseName(voice.name))) return null;
  const at = LANGS.findIndex((wanted) => lang.startsWith(wanted));
  const quality = /premium|enhanced/i.test(voice.name) ? 0 : 1;
  const natural = NATURAL.includes(firstWord(voice.name)) ? 0 : 1;
  return [quality, natural, at === -1 ? LANGS.length : at, voice.localService ? 0 : 1];
}

const compare = (a: number[], b: number[]): number => {
  for (let i = 0; i < a.length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * The best voice to read aloud with.
 * @param voices - What the device offers (`speechSynthesis.getVoices()`), in its order.
 * @returns The voice, or null when none is usable (the WAV fallback plays).
 */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[]): V | null {
  let best: { voice: V; key: number[] } | null = null;
  for (const voice of voices) {
    const key = rank(voice);
    if (key !== null && (best === null || compare(key, best.key) < 0)) best = { voice, key };
  }
  return best?.voice ?? null;
}
