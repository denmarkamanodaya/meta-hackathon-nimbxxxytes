// Port: turns a cloud media URL into the URL the player should load. The PWA plays the cloud URL
// as given; the Mac app plays the synced copy in ~/nimbytes when one is on disk.

/** Which synced file a URL stands for. */
export type MediaKind = 'proxy' | 'original' | 'render';

/** One media file the app wants to play. */
export interface MediaRef {
  kind: MediaKind;
  /** Clip id for `proxy` / `original`, short id for `render`. */
  id: string;
  /** The URL the API returned (presigned, expires). */
  cloudUrl: string;
}

/** Picks the playable URL for a media file. */
export interface MediaResolver {
  /**
   * The URL to show before `resolve` settles.
   * @returns `ref.cloudUrl` when it is already the answer (PWA), or null to wait (Mac app).
   */
  immediate(ref: MediaRef): string | null;
  /**
   * Resolves the URL to play. Never rejects: any lookup failure falls back to `cloudUrl`.
   * @returns A local asset URL when the file is synced, else `ref.cloudUrl`.
   */
  resolve(ref: MediaRef): Promise<string>;
}
