// Web env: the only reader of import.meta.env, so env keys have one home. Parsed once at boot; a bad
// value throws so the app fails fast instead of calling the wrong origin.

/** Parsed, validated web settings. */
export interface Env {
  /** API base path or origin, no trailing slash. `VITE_API_BASE`, default `/api`. */
  apiBase: string;
  /** True in a production build; gates service worker registration. */
  isProd: boolean;
}

/** Raw values as Vite exposes them; every key may be missing. */
export interface RawEnv {
  VITE_API_BASE?: string | undefined;
  PROD?: boolean | undefined;
}

const DEFAULT_API_BASE = '/api';

/**
 * Validates raw Vite env values.
 * @param raw - `import.meta.env` or a test double.
 * @returns The parsed settings.
 * @throws Error when `VITE_API_BASE` is neither an absolute path nor an http(s) URL.
 */
export function parseEnv(raw: RawEnv): Env {
  const trimmed = raw.VITE_API_BASE?.trim() ?? '';
  const value = trimmed === '' ? DEFAULT_API_BASE : trimmed;
  const isPath = value.startsWith('/') && !value.startsWith('//');
  if (!isPath && !/^https?:\/\/[^/]/.test(value)) {
    throw new Error(`VITE_API_BASE must be an absolute path or http(s) URL, got "${value}"`);
  }
  return { apiBase: value.replace(/\/+$/, ''), isProd: raw.PROD === true };
}

/** Settings for this build, parsed once. */
export const env: Env = parseEnv(import.meta.env);
