// A binary request body (a voice note) crosses the Tauri bridge as base64 text, since invoke
// arguments are JSON: `body_base64` beside `content_type`, which the native side decodes and sends
// as the raw body.

/** Bytes per `String.fromCharCode` call, under the engines' argument limits. */
const CHUNK = 0x8000;

/**
 * Encodes bytes as standard base64.
 * @param bytes - The bytes.
 * @returns The base64 text.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

/**
 * Decodes standard base64.
 * @param text - The base64 text.
 * @returns The bytes.
 */
export function base64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Reads a blob as base64.
 * @param blob - The body.
 * @returns The base64 text.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}
