// The brand kit: loaded once, saved on demand, and its images uploaded through a presigned PUT
// (`POST /brand/uploads`, then the file straight to storage).
import { useCallback, useState } from 'react';
import { checkBrandImage } from '../core/brand-kit';
import type { BrandKit, BrandResponse, SaveBrandRequest } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

const once = () => false;

/** Where a picked image goes: the logo, or reference slot 0–3. */
export type BrandImageSlot = { kind: 'logo' } | { kind: 'ref'; slot: number };

/** An uploaded image: its key (saved in the kit) and a local preview. */
export interface UploadedImage {
  key: string;
  previewUrl: string;
}

/** The kit's state and actions. */
export interface BrandKitHandle {
  state: Polled<BrandResponse>;
  /** Saves the kit; resolves it as saved, or null on failure (a toast says why). */
  save: (request: SaveBrandRequest) => Promise<BrandKit | null>;
  isSaving: boolean;
  /** Uploads one image; resolves its key and preview, or null when refused or failed. */
  upload: (slot: BrandImageSlot, file: File) => Promise<UploadedImage | null>;
  isUploading: boolean;
}

/**
 * Loads the brand kit once (mount it only while its sheet is open).
 * @returns The handle.
 */
export function useBrandKit(): BrandKitHandle {
  const { api, putFile, toasts } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getBrand(signal), [api]);
  const { state } = usePolled(load, { intervalMs: 60_000, keepPolling: once });
  const [isSaving, setSaving] = useState(false);
  const [isUploading, setUploading] = useState(false);

  const save = useCallback(
    async (request: SaveBrandRequest) => {
      setSaving(true);
      try {
        return await api.saveBrand(request);
      } catch (error) {
        toasts.error('Could not save the brand kit', error);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [api, toasts],
  );

  const upload = useCallback(
    async (slot: BrandImageSlot, file: File) => {
      const check = checkBrandImage(file);
      if (!check.ok) {
        toasts.info(check.reason, '');
        return null;
      }
      setUploading(true);
      try {
        const target = await api.createBrandUpload({
          kind: slot.kind,
          ...(slot.kind === 'ref' ? { slot: slot.slot } : {}),
          content_type: check.type,
          size_bytes: file.size,
        });
        await putFile(target.url, file, () => undefined, new AbortController().signal);
        return { key: target.key, previewUrl: URL.createObjectURL(file) };
      } catch (error) {
        toasts.error('Could not upload the image', error);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [api, putFile, toasts],
  );

  return { state, save, isSaving, upload, isUploading };
}
