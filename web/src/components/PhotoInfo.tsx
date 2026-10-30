// What the Gallery panel and a photo's page say about a photo (mock PhotosMock): the line
// "_MG_4210.JPG · 19 Aug 2026, 6:42 PM · 6000 × 4000 · 9.0 MB · Canon EOS", "What's in it" and the
// Things chips; while Muse Spark looks at it, a line saying so; a failed photo says why.
import { isPhotoBusy, PHOTO_COPY, photoSubLine } from '../core/photos';
import type { PhotoDetail } from '../services/api/types';
import { ListenCard } from './ListenParts';
import './PhotoInfo.css';

/**
 * The info.
 * @param props - The photo, and the class of its muted lines.
 * @returns The line and the cards.
 */
export function PhotoInfo({ photo, mutedClassName }: { photo: PhotoDetail; mutedClassName: string }) {
  return (
    <>
      <span className={mutedClassName}>{photoSubLine(photo)}</span>
      {isPhotoBusy(photo.status) && <span className={mutedClassName}>{PHOTO_COPY.analysingLine}</span>}
      {photo.status === 'failed' && <span className={mutedClassName}>{photo.error ?? PHOTO_COPY.failedTitle}</span>}
      {photo.description !== '' && (
        <ListenCard title={PHOTO_COPY.whatsInIt}>
          <p className="listen-summary">{photo.description}</p>
        </ListenCard>
      )}
      {photo.things.length > 0 && (
        <ListenCard title={PHOTO_COPY.things}>
          <span className="photo-info__things">
            {photo.things.map((thing) => (
              <span key={thing} className="photo-info__thing">
                {thing}
              </span>
            ))}
          </span>
        </ListenCard>
      )}
    </>
  );
}
