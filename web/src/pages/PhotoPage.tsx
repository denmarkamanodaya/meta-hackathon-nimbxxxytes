// A photo on the phone (`/photos/:id`, mock PhotosMock): the Back header with its title, its date
// line and Rename; the photo fitted to the screen; then what is in it and the things in it; Delete
// photo at the bottom. While Muse Spark looks at it, a line says so (the page polls).
import { useState } from 'react';
import { useParams } from 'react-router';
import { BackHeader } from '../components/BackHeader';
import { LoadError } from '../components/LoadError';
import { PhotoInfo } from '../components/PhotoInfo';
import { RenameSheet } from '../components/RenameSheet';
import { PHOTO_COPY, photoTitle, photoTitleProblem, takenLine } from '../core/photos';
import { ConfirmSheet } from '../design/ConfirmSheet';
import { Skeleton } from '../design/Skeleton';
import { useDeletePhoto, usePhoto, useRenamePhoto } from '../hooks/usePhotos';
import type { PhotoDetail } from '../services/api/types';
import './GuidePage.css';
import './PhotoPage.css';

function Rename({ photo, refresh }: { photo: PhotoDetail; refresh: () => void }) {
  const [isOpen, setOpen] = useState(false);
  const renamer = useRenamePhoto(refresh);
  return (
    <>
      <button
        type="button"
        className="guide-page__rename"
        onClick={() => {
          setOpen(true);
        }}
      >
        Rename
      </button>
      <RenameSheet
        open={isOpen}
        heading={PHOTO_COPY.renameTitle}
        label={PHOTO_COPY.titleField}
        saveLabel="Save"
        title={photoTitle(photo)}
        problemOf={photoTitleProblem}
        isSaving={renamer.isSaving}
        onSave={(title) => renamer.rename(photo.id, title)}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

function Delete({ photoId }: { photoId: string }) {
  const [isAsking, setAsking] = useState(false);
  const { remove, isDeleting } = useDeletePhoto();
  return (
    <>
      <button
        type="button"
        className="guide-page__delete"
        onClick={() => {
          setAsking(true);
        }}
      >
        Delete photo
      </button>
      <ConfirmSheet
        open={isAsking}
        title="Delete this photo?"
        body="The photo and what nimbytes read from it are removed. This can’t be undone."
        confirmLabel="Delete photo"
        busyLabel="Deleting…"
        isBusy={isDeleting}
        onConfirm={() => {
          void remove(photoId);
        }}
        onCancel={() => {
          setAsking(false);
        }}
      />
    </>
  );
}

/**
 * The page.
 * @returns The photo by its route id.
 */
export function PhotoPage() {
  const { id = '' } = useParams();
  const { state, refresh } = usePhoto(id);
  const photo = state.status === 'ready' ? state.data : null;
  const picture = photo === null ? null : (photo.image_url ?? photo.thumb_url);
  return (
    <div className="guide-page">
      <div className="guide-page__head">
        <BackHeader
          title={photo === null ? PHOTO_COPY.photo : photoTitle(photo)}
          subtitle={photo === null ? PHOTO_COPY.photo : takenLine(photo.taken_at) || PHOTO_COPY.photo}
          fallback="/"
          actions={photo === null ? undefined : <Rename photo={photo} refresh={refresh} />}
        />
      </div>
      <div className="guide-page__body">
        {state.status === 'loading' && (
          <div aria-busy="true">
            <p className="visually-hidden" role="status">
              Loading the photo…
            </p>
            <Skeleton kind="video" />
          </div>
        )}
        {state.status === 'error' && <LoadError error={state.error} thing="photo" onRetry={refresh} />}
        {picture !== null && (
          <div className="photo-page__frame">
            <img className="photo-page__img" src={picture} alt={photo?.description ?? ''} />
          </div>
        )}
        {photo !== null && <PhotoInfo photo={photo} mutedClassName="guide-page__muted" />}
        {photo !== null && <Delete photoId={photo.id} />}
      </div>
    </div>
  );
}
