// Where a Gallery entry opens: a clip's, photo's, recording's or document's own page (each route
// from its own hook module, so the paths stay in one place).
import type { ItemRef } from '../core/gallery-items';
import { documentPath } from './useDocuments';
import { listenPath } from './useListens';
import { photoPath } from './usePhotos';

/**
 * The page of a Gallery entry.
 * @param ref - From `itemRef`.
 * @returns `/clips/{id}`, `/photos/{id}`, `/ilisten/{id}` or `/iread/{id}`.
 */
export function itemPagePath(ref: ItemRef): string {
  switch (ref.kind) {
    case 'video':
      return `/clips/${encodeURIComponent(ref.id)}`;
    case 'photo':
      return photoPath(ref.id);
    case 'recording':
      return listenPath(ref.id);
    case 'document':
      return documentPath(ref.id);
  }
}
