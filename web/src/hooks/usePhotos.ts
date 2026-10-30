// Photo hooks: the list (polled faster while a photo is analysed), one photo (polled until read),
// adding many photos (the shared queue, three at a time, with the Gallery card's tally), renaming
// and deleting. Each failure raises a toast.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router';
import { isPhotoBusy, photoCount, photoPagePath, photoUploadCard, type PhotoUploadCard } from '../core/photos';
import type { PhotoDetail, PhotoSummary } from '../services/api/types';
import { fileSource, type PhotoSource } from '../services/upload/photo-queue';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** The route of one photo (its home is `core/photos`). */
export const photoPath = photoPagePath;

/** List poll interval, ms. */
export const PHOTOS_POLL_MS = 5000;
/** One photo's poll interval while it is analysed, ms. */
export const PHOTO_POLL_MS = 1500;

/**
 * Every photo, newest first as the API sends them.
 * @returns The polled list and `refresh`.
 */
export function usePhotos(): { state: Polled<PhotoSummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listPhotos(signal), [api]);
  return usePolled(load, { intervalMs: PHOTOS_POLL_MS });
}

const keepPollingPhoto = (photo: PhotoDetail) => isPhotoBusy(photo.status);

/**
 * One photo, polled until it is read or failed.
 * @param photoId - The photo.
 * @returns The polled photo and `refresh`.
 */
export function usePhoto(photoId: string): { state: Polled<PhotoDetail>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getPhoto(photoId, signal), [api, photoId]);
  return usePolled(load, { intervalMs: PHOTO_POLL_MS, keepPolling: keepPollingPhoto });
}

/** Adding photos. */
export interface AddPhotos {
  /** Queues picked files; resolves once the batch is done (a toast says when some did not go up). */
  add: (files: readonly File[]) => Promise<void>;
  /** Queues photos read only when their upload starts (the Mac's picked paths). */
  addSources: (sources: readonly PhotoSource[]) => Promise<void>;
  /** The Gallery card while a batch goes up; null when none does. */
  card: PhotoUploadCard | null;
}

/**
 * Upload of many photos through the shared queue (every page that adds or shows them sees the
 * same batch).
 * @returns `add` and the card.
 */
export function useAddPhotos(): AddPhotos {
  const { photoUploads, toasts } = useServices();
  const state = useSyncExternalStore(photoUploads.subscribe, photoUploads.getSnapshot);
  const addSources = useCallback(
    async (sources: readonly PhotoSource[]) => {
      const settled = await photoUploads.add(sources);
      if (settled.failed > 0) {
        toasts.info(`Could not add ${String(settled.failed)} of ${photoCount(settled.total)}`, 'Check the file type (JPEG, PNG, WebP, HEIC) and size (40 MB), then add them again.');
      }
    },
    [photoUploads, toasts],
  );
  const add = useCallback((files: readonly File[]) => addSources(files.map(fileSource)), [addSources]);
  return { add, addSources, card: photoUploadCard(state.done, state.total) };
}

/** Renaming a photo. */
export interface RenamePhoto {
  rename: (photoId: string, title: string) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * Rename…: PATCHes the title; a failure raises a toast.
 * @param onRenamed - Called after a rename succeeds.
 * @returns `rename` and whether it runs.
 */
export function useRenamePhoto(onRenamed: () => void): RenamePhoto {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);
  const rename = useCallback(
    async (photoId: string, title: string) => {
      setSaving(true);
      try {
        await api.renamePhoto(photoId, title);
        onRenamed();
        return true;
      } catch (error) {
        toasts.error('Could not rename the photo', error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, onRenamed, toasts],
  );
  return { rename, isSaving };
}

/** Deleting a photo from its page. */
export interface DeletePhoto {
  remove: (photoId: string) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Delete photo on its page: removes it and goes back to the Gallery.
 * @returns `remove` and whether it runs.
 */
export function useDeletePhoto(): DeletePhoto {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const remove = useCallback(
    async (photoId: string) => {
      setDeleting(true);
      try {
        await api.deletePhoto(photoId);
        void navigate('/', { replace: true });
        return true;
      } catch (error) {
        toasts.error('Could not delete the photo', error);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [api, navigate, toasts],
  );
  return { remove, isDeleting };
}
