// iListen's languages (pure): the output languages a summary can be written in, each named in its
// own words ("中文", "日本語"), and the words for a language heard ("中文 60%", "中文 Chinese 60%").
// A language the list does not hold keeps its code.

/** One output language: its ISO 639-1 code, its own name and its English name. */
export interface OutputLanguage {
  code: string;
  label: string;
  english: string;
}

/** The curated output languages (phase 31), English first. */
export const OUTPUT_LANGUAGES: readonly OutputLanguage[] = [
  { code: 'en', label: 'English', english: 'English' },
  { code: 'zh', label: '中文', english: 'Chinese' },
  { code: 'ja', label: '日本語', english: 'Japanese' },
  { code: 'ko', label: '한국어', english: 'Korean' },
  { code: 'tl', label: 'Tagalog', english: 'Tagalog' },
  { code: 'es', label: 'Español', english: 'Spanish' },
  { code: 'fr', label: 'Français', english: 'French' },
  { code: 'de', label: 'Deutsch', english: 'German' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', label: 'ไทย', english: 'Thai' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi' },
];

/** The output language before the user picks one. */
export const DEFAULT_TARGET = 'en';

const byCode = (code: string): OutputLanguage | undefined => OUTPUT_LANGUAGES.find((each) => each.code === code.toLowerCase());

/**
 * Whether `code` is an output language.
 * @param code - Any string.
 * @returns True for a listed code.
 */
export const isOutputLanguage = (code: string): boolean => byCode(code) !== undefined;

/**
 * A language in its own words ("中文"); an unlisted code stays as it is, upper case ("PT").
 * @param code - ISO 639-1.
 * @returns The name.
 */
export const languageLabel = (code: string): string => byCode(code)?.label ?? code.toUpperCase();

/**
 * A language in its own words and in English, when they differ ("中文 Chinese"; "English").
 * @param code - ISO 639-1.
 * @returns The name.
 */
export function languageBoth(code: string): string {
  const language = byCode(code);
  if (language === undefined) return code.toUpperCase();
  return language.label === language.english ? language.label : `${language.label} ${language.english}`;
}

/**
 * A language heard with its share ("中文 60%").
 * @param heard - Code and whole-percent share.
 * @returns The words.
 */
export const heardLabel = (heard: { code: string; share: number }): string => `${languageLabel(heard.code)} ${String(heard.share)}%`;
