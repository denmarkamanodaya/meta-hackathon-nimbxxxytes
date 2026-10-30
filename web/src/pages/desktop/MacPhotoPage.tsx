// A photo on the Mac (`/photos/:id`, mock PhotosMock): "‹ Gallery / title" and ⋯ (Rename…, Delete
// photo…); the photo fitted to the window; on the right, its line, What's in it and Things.
import { useNavigate, useParams } from 'react-router';
import { LoadError } from '../../components/LoadError';
import { PhotoInfo } from '../../components/PhotoInfo';
import { MacColumns, MacCrumb } from '../../components/desktop/MacColumns';
import { MacPhotoOptions } from '../../components/desktop/MacPhotoOptions';
import { NAV_COPY } from '../../core/copy';
import { photoTitle } from '../../core/photos';
import { Skeleton } from '../../design/Skeleton';
import { usePhoto } from '../../hooks/usePhotos';
import './MacGuidePage.css';
import '../PhotoPage.css';
import '../../components/desktop/GalleryItemPanel.css';

/**
 * The page (`/photos/:id` in the Mac app).
 * @returns The page.
 */
export function MacPhotoPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { state, refresh } = usePhoto(id);
  const photo = state.status === 'ready' ? state.data : null;
  const picture = photo === null ? null : (photo.image_url ?? photo.thumb_url);
  return (
    <MacColumns
      asideLabel="About this photo"
      aside={
        photo === null ? undefined : (
          <div className="photo-page__aside">
            <PhotoInfo photo={photo} mutedClassName="gallery-item__sub" />
          </div>
        )
      }
    >
      <header className="mac-columns__head mac-columns__head--crumb">
        <MacCrumb to="/" label={NAV_COPY.gallery} />
        <h1 className="mac-columns__crumb-title mac-guide__head-title">{photo === null ? '' : photoTitle(photo)}</h1>
        {photo !== null && (
          <MacPhotoOptions
            photoId={photo.id}
            title={photoTitle(photo)}
            className="mac-button mac-button--head mac-button--icon"
            onRenamed={refresh}
            onDeleted={() => {
              void navigate('/', { replace: true });
            }}
          />
        )}
      </header>
      {state.status === 'loading' && (
        <div className="mac-guide__state" aria-busy="true">
          <Skeleton kind="video" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="photo" onRetry={refresh} />}
      {picture !== null && (
        <div className="photo-page__mac">
          <div className="photo-page__frame">
            <img className="photo-page__img" src={picture} alt={photo?.description ?? ''} />
          </div>
        </div>
      )}
    </MacColumns>
  );
}
