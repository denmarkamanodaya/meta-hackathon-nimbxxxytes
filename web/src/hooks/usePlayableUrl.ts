// The URL a player should load for a clip proxy or a render: the cloud URL in the PWA, the synced
// copy in ~/nimbytes in the Mac app when it is on disk.
import { useEffect, useRef, useState } from 'react';
import type { MediaKind } from '../core/ports/media-resolver';
import { useServices } from './services-context';

/** A finished lookup: whether it found a local copy, and its URL. */
interface Lookup {
  key: string;
  localUrl: string | null;
}

/**
 * Resolves a media file through the composed `MediaResolver`. A new presigned cloud URL for the
 * same file (polling) does not look it up again: a local copy stays local, and a cloud answer
 * follows the newest cloud URL.
 * @param kind - `proxy` / `original` (clip id) or `render` (short id).
 * @param id - The clip or short id.
 * @param cloudUrl - The URL the API returned, or null when there is no file yet.
 * @returns The URL to play, or null while there is none (or while the Mac app looks it up).
 */
export function usePlayableUrl(kind: MediaKind, id: string, cloudUrl: string | null): string | null {
  const { media } = useServices();
  const [lookup, setLookup] = useState<Lookup | null>(null);
  const latestUrl = useRef(cloudUrl);
  useEffect(() => {
    latestUrl.current = cloudUrl;
  });
  const hasFile = cloudUrl !== null;
  const key = `${kind}:${id}`;
  useEffect(() => {
    const url = latestUrl.current;
    if (url === null) return;
    let isLive = true;
    void media.resolve({ kind, id, cloudUrl: url }).then((resolved) => {
      if (isLive) setLookup({ key, localUrl: resolved === url ? null : resolved });
    });
    return () => {
      isLive = false;
    };
  }, [media, kind, id, key, hasFile]);
  if (cloudUrl === null) return null;
  if (lookup?.key === key) return lookup.localUrl ?? cloudUrl;
  return media.immediate({ kind, id, cloudUrl });
}
