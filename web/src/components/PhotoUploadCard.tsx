// "Uploading 12 photos", a bar, and "7 of 12 · then nimbytes looks at each one" (mock PhotosMock),
// while a batch of photos goes up. The Gallery, the phone Library and the Upload page show it.
import { useAddPhotos } from '../hooks/usePhotos';
import './PhotoUploadCard.css';

/**
 * The card; nothing when no photos are going up.
 * @returns The card.
 */
export function PhotoUploadCard() {
  const { card } = useAddPhotos();
  if (card === null) return null;
  return (
    <div className="photo-upload" role="status">
      <b className="photo-upload__title">{card.title}</b>
      <span className="photo-upload__bar" aria-hidden="true">
        <span className="photo-upload__fill" style={{ width: `${String(card.percent)}%` }} />
      </span>
      <span className="photo-upload__line">{card.line}</span>
    </div>
  );
}
