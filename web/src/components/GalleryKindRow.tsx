// The Gallery's kind filter row (mock GalleryMixedMock): All · Videos · Recordings · Documents,
// each with its count; the chosen one filled. The Mac Gallery and the phone Library share it.
import { GALLERY_KIND_LABEL, GALLERY_KINDS, type GalleryKind, type KindCounts } from '../core/gallery-items';
import './GalleryKindRow.css';

/**
 * The row.
 * @param props - The kind shown, the counts and the setter.
 * @returns The chips.
 */
export function GalleryKindRow({ kind, counts, onKind }: { kind: GalleryKind; counts: KindCounts; onKind: (next: GalleryKind) => void }) {
  return (
    <div className="gallery-kinds" role="group" aria-label="Show kinds">
      {GALLERY_KINDS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === kind}
          className={option === kind ? 'gallery-kinds__chip gallery-kinds__chip--on' : 'gallery-kinds__chip'}
          onClick={() => {
            onKind(option);
          }}
        >
          {GALLERY_KIND_LABEL[option]}
          <b>{counts[option]}</b>
        </button>
      ))}
    </div>
  );
}
