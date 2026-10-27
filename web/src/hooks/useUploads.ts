// Hooks over the app-wide upload queue, the pre-upload duplicate check and the screen wake lock.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { UploadItem } from '../services/upload/queue';
import { useServices } from './services-context';

/**
 * Subscribes to the upload queue.
 * @returns The items in pick order plus `add` (pick files) and `retry` (a failed item).
 */
export function useUploads(): {
  items: readonly UploadItem[];
  add: (files: readonly File[]) => void;
  retry: (id: string) => void;
} {
  const { uploads } = useServices();
  const items = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot);
  return { items, add: uploads.add, retry: uploads.retry };
}

/**
 * True while any file is queued or uploading.
 * @param items - Queue snapshot.
 * @returns Whether uploads still need the screen on.
 */
export function isUploading(items: readonly UploadItem[]): boolean {
  return items.some((item) => item.state === 'queued' || item.state === 'uploading');
}

/**
 * Holds the screen wake lock while `active`.
 * @param active - Whether uploads are running.
 */
export function useKeepAwake(active: boolean): void {
  const { wakeLock } = useServices();
  useEffect(() => {
    wakeLock.setActive(active);
  }, [wakeLock, active]);
}

/** A picked file that matches a clip already in the library, waiting for Skip or Upload anyway. */
export interface HeldFile {
  id: string;
  file: File;
  /** Title of the clip it matches. */
  title: string;
}

/**
 * Picking with a duplicate check: each file is checked (`POST /uploads/check`) before it is
 * queued. Files that match a library clip are held; Skip (the default) drops them, Upload anyway
 * queues them. A failed check queues the file: the server still catches exact copies by hash.
 * @returns Held files, `pick`, `skip` and `uploadAnyway`.
 */
export function usePickWithCheck(): {
  held: readonly HeldFile[];
  pick: (files: readonly File[]) => Promise<void>;
  skip: (id: string) => void;
  uploadAnyway: (id: string) => void;
} {
  const { api, uploads } = useServices();
  const [held, setHeld] = useState<HeldFile[]>([]);
  const nextId = useRef(0);

  const pick = useCallback(
    async (files: readonly File[]) => {
      const answers = await Promise.all(
        files.map((file) =>
          api.checkUpload({ filename: file.name, size_bytes: file.size }).then(
            (answer) => answer.duplicate_of,
            () => null,
          ),
        ),
      );
      const fresh = files.filter((_, index) => answers[index] == null);
      const matched = files.flatMap((file, index) => {
        const match = answers[index];
        if (match == null) return [];
        nextId.current += 1;
        return [{ id: `held_${String(nextId.current)}`, file, title: match.title }];
      });
      if (fresh.length > 0) uploads.add(fresh);
      if (matched.length > 0) setHeld((current) => [...current, ...matched]);
    },
    [api, uploads],
  );
  const skip = useCallback((id: string) => {
    setHeld((current) => current.filter((item) => item.id !== id));
  }, []);
  const uploadAnyway = useCallback(
    (id: string) => {
      const item = held.find((h) => h.id === id);
      if (item === undefined) return;
      uploads.add([item.file]);
      setHeld((current) => current.filter((h) => h.id !== id));
    },
    [held, uploads],
  );
  return { held, pick, skip, uploadAnyway };
}
