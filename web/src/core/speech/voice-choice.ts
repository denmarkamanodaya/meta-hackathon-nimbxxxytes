// Which device voice reads aloud (pure). English by default: en-GB first, then en-AU, en-US, other
// en-*. iListen asks for another language (its summary's): only voices of that language count, a
// mainland voice first for Chinese, any region otherwise.
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

/** Regions tried first, best first, per language; a language not listed takes any region. */
const REGIONS: Record<string, readonly string[]> = {
  en: ['en-gb', 'en-au', 'en-us'],
  zh: ['zh-cn', 'zh-tw', 'zh-hk'],
};

/** The name before any "(English (UK))" or "(Enhanced)", lower case. */
const baseName = (name: string): string => (name.toLowerCase().split('(')[0] ?? '').trim();

const firstWord = (name: string): string => baseName(name).split(' ')[0] ?? '';

/** Lower is better; null when the voice is never used. */
function rank(voice: VoiceInfo, language: string): number[] | null {
  const lang = voice.lang.toLowerCase().replace('_', '-');
  if (lang.split('-')[0] !== language || NOVELTY.includes(baseName(voice.name))) return null;
  const regions = REGIONS[language] ?? [];
  const at = regions.findIndex((wanted) => lang.startsWith(wanted));
  const quality = /premium|enhanced/i.test(voice.name) ? 0 : 1;
  const natural = NATURAL.includes(firstWord(voice.name)) ? 0 : 1;
  return [quality, natural, at === -1 ? regions.length : at, voice.localService ? 0 : 1];
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
 * @param language - ISO 639-1 of the text (English when left out).
 * @returns The voice, or null when none is usable (the WAV fallback plays).
 */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], language = 'en'): V | null {
  let best: { voice: V; key: number[] } | null = null;
  for (const voice of voices) {
    const key = rank(voice, language.toLowerCase());
    if (key !== null && (best === null || compare(key, best.key) < 0)) best = { voice, key };
  }
  return best?.voice ?? null;
}
