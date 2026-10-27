// The Gallery's grid/list choice and thumbnail size: read once from the prefs store, written back
// on every change (the Gallery and project pages share them).
import { useCallback, useState } from 'react';
import type { GalleryPrefs } from '../core/gallery';
import { useServices } from './services-context';

/**
 * The prefs and their setter.
 * @returns `[prefs, setPrefs]`.
 */
export function useGalleryPrefs(): [GalleryPrefs, (next: GalleryPrefs) => void] {
  const { galleryPrefs } = useServices();
  const [prefs, setPrefs] = useState<GalleryPrefs>(() => galleryPrefs.read());
  const update = useCallback(
    (next: GalleryPrefs) => {
      setPrefs(next);
      galleryPrefs.write(next);
    },
    [galleryPrefs],
  );
  return [prefs, update];
}
