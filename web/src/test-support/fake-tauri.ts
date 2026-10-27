// Fake Tauri IPC for the desktop adapter tests: records every invoke with its exact args, answers
// from a per-command table, and lets a test push channel messages and native events.
import type { TauriIpc } from '../services/desktop/tauri-bridge';

/** One recorded native call. */
export interface InvokeCall {
  command: string;
  args: Record<string, unknown> | undefined;
}

/** How the fake answers a command: a value, a rejection, or a function of the args. */
export type FakeAnswer =
  | { resolve: unknown }
  /** Tauri rejects with the command's error value, usually a plain string. */
  | { reject: string | Error }
  | { run: (args: Record<string, unknown> | undefined) => Promise<unknown> };

/** A fake channel: what the adapter passed in, plus a way to push messages into it. */
export interface FakeChannel {
  push: (message: unknown) => void;
}

/** The fake IPC and its controls. */
export interface FakeTauri {
  ipc: TauriIpc;
  calls: InvokeCall[];
  /** Channels made so far, in order. */
  channels: FakeChannel[];
  /** Pushes a native event to every listener of `event`. */
  emit: (event: string, payload: unknown) => void;
  /** Listeners still registered, per event. */
  listenerCount: (event: string) => number;
}

/**
 * Builds the fake.
 * @param answers - Answer per command name; a command without one rejects with "unknown command".
 * @returns The fake.
 */
export function fakeTauri(answers: Record<string, FakeAnswer> = {}): FakeTauri {
  const calls: InvokeCall[] = [];
  const channels: FakeChannel[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const ipc: TauriIpc = {
    invoke: (command, args) => {
      calls.push({ command, args });
      const answer = answers[command];
      if (answer === undefined) return Promise.reject(new Error(`unknown command ${command}`));
      if ('resolve' in answer) return Promise.resolve(answer.resolve);
      if ('reject' in answer) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- Tauri's invoke rejects with the command's error value, usually a plain string; the fake must do the same so the adapters' string handling is tested.
        return Promise.reject(answer.reject);
      }
      return answer.run(args);
    },
    convertFileSrc: (path) => `asset://localhost/${encodeURIComponent(path)}`,
    listen: (event, onPayload) => {
      const set = listeners.get(event) ?? new Set();
      const listener = (payload: unknown) => {
        onPayload(payload);
      };
      set.add(listener);
      listeners.set(event, set);
      return Promise.resolve(() => {
        set.delete(listener);
      });
    },
    channel: (onMessage) => {
      const channel: FakeChannel = {
        push: (message) => {
          onMessage(message);
        },
      };
      channels.push(channel);
      return channel;
    },
  };
  return {
    ipc,
    calls,
    channels,
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  };
}
