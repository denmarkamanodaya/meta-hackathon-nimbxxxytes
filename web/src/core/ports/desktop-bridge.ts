// Port: the Mac app's native features the web app drives (sync, offline originals, the editing
// bridge, Finder). Present only in the desktop build; the PWA has none.
import type { SyncStatus } from '../desktop-sync';
import type { MediaKind } from './media-resolver';

/** What `reveal` shows in Finder. */
export type RevealTarget =
  | { kind: 'folder' }
  | { kind: 'fcpxml'; shortId: string }
  | { kind: 'render'; shortId: string }
  | { kind: 'original'; clipId: string };

/** Where `openInEditor` opened the timeline. */
export interface OpenedTimeline {
  /** Absolute path of the written FCPXML. */
  fcpxmlPath: string;
  /** `final-cut` when Final Cut Pro opened it, `finder` when only revealed. */
  openedWith: 'final-cut' | 'finder';
}

/**
 * Native calls. Every method rejects with a typed `DESKTOP_FAILED` error when the native side
 * refuses or fails.
 */
export interface DesktopBridge {
  /** The server URL the app talks to (set at build time), or null when the app has none. */
  server(): Promise<string | null>;
  /** The current sync status. */
  syncStatus(): Promise<SyncStatus>;
  /**
   * Opens the native file dialog (mp4, mov, m4v) and queues the picked files for upload; progress
   * shows in `SyncStatus.transfers` with direction `up`.
   * @returns How many files were queued (0 when cancelled).
   */
  pickAndUpload(): Promise<number>;
  /**
   * Listens for pushed status updates.
   * @returns A function that stops listening.
   */
  onSyncStatus(listener: (status: SyncStatus) => void): () => void;
  /** Starts a sync now. */
  syncNow(): Promise<void>;
  /** Pins (true) or unpins the clip's original in `Originals/`. */
  setOffline(clipId: string, offline: boolean): Promise<void>;
  /** Sets the auto-original cache budget in GB. */
  setCacheBudget(gb: number): Promise<void>;
  /** Writes the short's FCPXML and opens it in Final Cut Pro, or reveals it. */
  openInEditor(shortId: string): Promise<OpenedTimeline>;
  /** Reveals a file or the synced folder in Finder. */
  reveal(target: RevealTarget): Promise<void>;
  /** True when the file is fully synced on disk (`media_lookup` found a path). */
  isOnDisk(kind: MediaKind, id: string): Promise<boolean>;
  /** Clears the session the native side keeps in the Keychain. */
  signOut(): Promise<void>;
  /** The app's version (`1.0.4`), for Settings › Account. */
  appVersion(): Promise<string>;
  /** Whether the app opens at login (the same login item as the menu bar icon's menu). */
  loginEnabled(): Promise<boolean>;
  /** Turns opening at login on or off. */
  setLoginEnabled(enabled: boolean): Promise<void>;
  /**
   * Frees the drive cache now, keeping clips kept offline and files being read.
   * @returns The bytes freed.
   */
  freeUpSpace(): Promise<number>;
}
