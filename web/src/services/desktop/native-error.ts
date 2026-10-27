// Reads a rejected Tauri command: the native side rejects with `{ code, message }` (UPPER_SNAKE
// code), and Tauri itself may reject with a plain string.
import { isRecord, isString } from '../api/json-guards';

/** A native failure, normalised. */
export interface NativeFailure {
  /** The native `UPPER_SNAKE` code (`NETWORK`, `IO`, ...), or null when none came. */
  code: string | null;
  message: string;
}

/**
 * Normalises a rejection value.
 * @param thrown - What the invoke promise rejected with.
 * @param fallback - Message when the value carries none.
 * @returns Code and message.
 */
export function readNativeFailure(thrown: unknown, fallback: string): NativeFailure {
  if (isString(thrown)) return { code: null, message: thrown === '' ? fallback : thrown };
  if (isRecord(thrown)) {
    const code = isString(thrown.code) ? thrown.code : null;
    const message = isString(thrown.message) && thrown.message !== '' ? thrown.message : (code ?? fallback);
    return { code, message };
  }
  return { code: null, message: fallback };
}
