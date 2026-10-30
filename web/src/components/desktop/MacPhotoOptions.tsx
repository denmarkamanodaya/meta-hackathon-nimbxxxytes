// A photo's ⋯ on the Mac (the Gallery panel and the photo's page): "Rename…" opens the shared
// rename sheet, "Delete photo…" the red confirm. `onDeleted` decides what happens after (the
// Gallery stays and reloads; the photo's page goes back to the Gallery).
import { useState } from 'react';
import { photoItemId } from '../../core/gallery-items';
import { PHOTO_COPY, photoTitleProblem } from '../../core/photos';
import { Icon } from '../../design/Icon';
import { Menu } from '../../design/Menu';
import { useMenu } from '../../hooks/useMenu';
import { useRenamePhoto } from '../../hooks/usePhotos';
import { GalleryDeleteSheet } from '../GalleryDeleteSheet';
import { MacDialog } from './MacDialog';
import { RenameForm } from './RenameForm';

function Rename({ photoId, title, onClose, onRenamed }: { photoId: string; title: string; onClose: () => void; onRenamed: () => void }) {
  const { rename, isSaving } = useRenamePhoto(onRenamed);
  return (
    <RenameForm
      heading={PHOTO_COPY.renameTitle}
      label={PHOTO_COPY.titleField}
      initial={title}
      problemOf={photoTitleProblem}
      isSaving={isSaving}
      onSave={(next) => rename(photoId, next)}
      onClose={onClose}
    />
  );
}

/** Props for `MacPhotoOptions`. */
export interface MacPhotoOptionsProps {
  photoId: string;
  title: string;
  /** The ⋯ button's class. */
  className: string;
  onRenamed: () => void;
  onDeleted: () => void;
}

/**
 * The ⋯ button, its menu and the dialogs.
 * @param props - See `MacPhotoOptionsProps`.
 * @returns The controls.
 */
export function MacPhotoOptions({ photoId, title, className, onRenamed, onDeleted }: MacPhotoOptionsProps) {
  const menu = useMenu();
  const [ask, setAsk] = useState<'rename' | 'delete' | null>(null);
  const close = () => {
    setAsk(null);
  };
  return (
    <>
      <button type="button" className={className} aria-label={`${PHOTO_COPY.options}: Rename or delete`} aria-haspopup="menu" onClick={menu.openFromButton}>
        <Icon name="more" size="xs" />
      </button>
      <Menu
        anchor={menu.anchor}
        label={PHOTO_COPY.options}
        onClose={menu.close}
        className="mac-menu--narrow"
        items={[
          {
            kind: 'item',
            label: PHOTO_COPY.renamePhoto,
            onSelect: () => {
              setAsk('rename');
            },
          },
          {
            kind: 'item',
            label: 'Delete photo…',
            isDanger: true,
            onSelect: () => {
              setAsk('delete');
            },
          },
        ]}
      />
      <MacDialog open={ask === 'rename'} label={PHOTO_COPY.renameTitle} onClose={close}>
        {ask === 'rename' && <Rename photoId={photoId} title={title} onClose={close} onRenamed={onRenamed} />}
      </MacDialog>
      <GalleryDeleteSheet
        itemIds={ask === 'delete' ? [photoItemId(photoId)] : []}
        onCancel={close}
        onDone={(outcome) => {
          close();
          if (outcome.deleted.length > 0) onDeleted();
        }}
      />
    </>
  );
}
