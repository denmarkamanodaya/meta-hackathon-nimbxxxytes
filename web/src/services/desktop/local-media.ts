// Mac app media: plays the synced copy in ~/nimbytes through the asset protocol when the native
// side reports it fully synced (`media_lookup`), else the cloud URL.
import type { MediaResolver } from '../../core/ports/media-resolver';
import { isNullable, isRecord, isString } from '../api/json-guards';
import type { TauriIpc } from './tauri-bridge';

const lookedUpPath = (value: unknown): string | null =>
  isRecord(value) && isNullable(value.path, isString) ? value.path : null;

/**
 * Builds the resolver.
 * @param ipc - Tauri IPC (the real one, or a fake in tests).
 * @returns The resolver; a failed or malformed lookup falls back to the cloud URL.
 */
export function createLocalMediaResolver(ipc: TauriIpc): MediaResolver {
  return {
    immediate: () => null,
    resolve: async ({ kind, id, cloudUrl }) => {
      let answer: unknown;
      try {
        answer = await ipc.invoke('media_lookup', { kind, id });
      } catch {
        return cloudUrl; // Recovers: the cloud copy always plays; the local one is a speed-up.
      }
      const path = lookedUpPath(answer);
      return path === null || path === '' ? cloudUrl : ipc.convertFileSrc(path);
    },
  };
}
