// The few Tauri calls the desktop adapters make, behind one small interface so the adapters are
// tested with a fake (test-support/fake-tauri.ts) instead of the real IPC.
import { Channel, convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Tauri IPC as the desktop adapters use it. */
export interface TauriIpc {
  /** Calls a native command; resolves its raw result, rejects with the command's error. */
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  /** Wraps an absolute file path as a URL the webview can load (the asset protocol). */
  convertFileSrc(path: string): string;
  /**
   * Listens for a native event.
   * @returns A promise of the function that stops listening.
   */
  listen(event: string, onPayload: (payload: unknown) => void): Promise<() => void>;
  /** Makes a channel to pass as a command argument; the native side streams raw messages in. */
  channel(onMessage: (message: unknown) => void): unknown;
}

/** The real Tauri IPC (only works inside the Mac app's webview). */
export const tauriIpc: TauriIpc = {
  invoke: (command, args) => invoke<unknown>(command, args),
  convertFileSrc: (path) => convertFileSrc(path),
  listen: (event, onPayload) =>
    listen<unknown>(event, (message) => {
      onPayload(message.payload);
    }),
  channel: (onMessage) => new Channel<unknown>(onMessage),
};
