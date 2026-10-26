// Hooks over the app-wide upload queue and the screen wake lock.
import { useEffect, useSyncExternalStore } from 'react';
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
