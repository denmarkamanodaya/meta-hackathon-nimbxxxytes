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

/** A photo picked in the native file dialog, read with `readPickedImage`. */
export interface PickedImage {
  path: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Ms since the epoch; null when unknown. */
  lastModifiedMs: number | null;
}

/** What the native file dialog picked. */
export interface PickedFiles {
  /** Videos queued on the upload engine. */
  queued: number;
  images: PickedImage[];
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
   * Opens the native file dialog (videos: mp4, mov, m4v; photos: jpg, jpeg, png, webp, heic, heif)
   * and queues the picked videos for upload (progress shows in `SyncStatus.transfers` with
   * direction `up`). The picked photos come back for the photo upload.
   * @returns How many videos were queued (0 when cancelled) and the photos picked.
   */
  pickAndUpload(): Promise<PickedFiles>;
  /**
   * The bytes of a photo `pickAndUpload` handed back, once, as a file.
   * @param image - One of the picked photos.
   * @returns The file, with its name, type and last-modified time.
   */
  readPickedImage(image: PickedImage): Promise<File>;
  /**
   * Opens the native folder dialog and queues every video inside it (subfolders too) for upload,
   * the same way as `pickAndUpload`.
   * @returns How many files were queued (0 when cancelled or none were found).
   */
  pickFolderAndUpload(): Promise<number>;
  /**
   * Cancels a picked upload; it stops after the part in flight and leaves the transfers.
   * @param transferId - The transfer's id in `SyncStatus.transfers`.
   */
  cancelUpload(transferId: string): Promise<void>;
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
