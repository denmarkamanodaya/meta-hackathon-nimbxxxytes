// Web env: the only reader of import.meta.env, so env keys have one home. Parsed once at boot; a bad
// value throws so the app fails fast instead of calling the wrong origin.

/** Parsed, validated web settings. */
export interface Env {
  /** API base path or origin, no trailing slash. `VITE_API_BASE`, default `/api`. */
  apiBase: string;
  /** True in a production build; gates service worker registration. */
  isProd: boolean;
  /** True in the Mac app build (`vite --mode desktop`): no service worker, native adapters. */
  isDesktop: boolean;
  /** Download page of the Mac app (`VITE_MAC_DOWNLOAD_URL`, https), or null to hide the link. */
  macDownloadUrl: string | null;
}

/** Raw values as Vite exposes them; every key may be missing. */
export interface RawEnv {
  VITE_API_BASE?: string | undefined;
  VITE_MAC_DOWNLOAD_URL?: string | undefined;
  PROD?: boolean | undefined;
  MODE?: string | undefined;
}

const DEFAULT_API_BASE = '/api';

/** The Vite mode of the Mac app build. */
const DESKTOP_MODE = 'desktop';

function parseMacDownloadUrl(raw: string | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '') return null;
  if (!/^https:\/\/[^/]/.test(value)) {
    throw new Error(`VITE_MAC_DOWNLOAD_URL must be an https URL, got "${value}"`);
  }
  return value;
}

/**
 * Validates raw Vite env values.
 * @param raw - `import.meta.env` or a test double.
 * @returns The parsed settings.
 * @throws Error when `VITE_API_BASE` is neither an absolute path nor an http(s) URL, or when
 *   `VITE_MAC_DOWNLOAD_URL` is set but not an https URL.
 */
export function parseEnv(raw: RawEnv): Env {
  const trimmed = raw.VITE_API_BASE?.trim() ?? '';
  const value = trimmed === '' ? DEFAULT_API_BASE : trimmed;
  const isPath = value.startsWith('/') && !value.startsWith('//');
  if (!isPath && !/^https?:\/\/[^/]/.test(value)) {
    throw new Error(`VITE_API_BASE must be an absolute path or http(s) URL, got "${value}"`);
  }
  return {
    apiBase: value.replace(/\/+$/, ''),
    isProd: raw.PROD === true,
    isDesktop: raw.MODE === DESKTOP_MODE,
    macDownloadUrl: parseMacDownloadUrl(raw.VITE_MAC_DOWNLOAD_URL),
  };
}

/** Settings for this build, parsed once. */
export const env: Env = parseEnv(import.meta.env);
