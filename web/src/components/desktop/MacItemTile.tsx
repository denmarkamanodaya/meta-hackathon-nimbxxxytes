// A photo, a recording or a document in the Mac Gallery grid (mocks GalleryMixedMock, PhotosMock): a
// photo shows its picture with "Photo" top left ("Looking at it…" while Muse Spark reads it); a
// recording shows its
// Muse Image cover (or the waveform tile while it has none), "♪ Recording" top left, the check
// score top right, the length bottom right and its languages along the bottom ("中文 日本語 → EN");
// while it is listened to, the step instead. A document shows its first page on a dark mat with
// its kind ("Bill"). Under each, the title and "19 Aug 2026 · Photo", "30 Oct 2026 · iListen" or
// "29 Oct 2026 · iRead · 1 page". A click selects (the page decides), a double click opens it,
// right-click opens its menu, and it drags onto a segment like a clip.
import type { DragEvent, MouseEvent } from 'react';
import { documentBadge, itemTileLine, itemTitle, recordingChips, type GalleryItem } from '../../core/gallery-items';
import { isPhotoBusy, PHOTO_COPY } from '../../core/photos';
import { formatDuration } from '../../core/format';
import { isListenBusy, listenPill } from '../../core/ilisten/listens';
import { Icon } from '../../design/Icon';
import type { DocumentSummary, ListenSummary, PhotoSummary } from '../../services/api/types';
import { WaveArt } from '../ItemTile';
import { SelectTick } from './SelectTick';
import './MacClipTile.css';
import '../ItemTile.css';

/** Props for `MacItemTile`. */
export interface MacItemTileProps {
  item: Exclude<GalleryItem, { kind: 'video' }>;
  isSelected: boolean;
  isSelecting: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onOpen: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
}

function RecordingThumb({ listen }: { listen: ListenSummary }) {
  const pill = listenPill(listen, true);
  const chips = recordingChips(listen);
  return (
    <>
      {listen.cover_url === null ? <WaveArt /> : <img className="mac-clip-tile__img" src={listen.cover_url} alt="" loading="lazy" />}
      <span className="item-tile__kind">
        <Icon name="wave" size="xs" />
        Recording
      </span>
      <span className={`item-tile__score item-tile__score--${pill.tone}`}>{pill.label}</span>
      {chips.length > 0 && (
        <span className="item-tile__langs">
          {chips.map((chip) => (
            <span key={chip} className="item-tile__lang">
              {chip}
            </span>
          ))}
        </span>
      )}
      {listen.duration_ms !== null && !isListenBusy(listen.status) && <span className="mac-clip-tile__duration">{formatDuration(listen.duration_ms / 1000)}</span>}
    </>
  );
}

function DocumentThumb({ doc }: { doc: DocumentSummary }) {
  return (
    <>
      <span className="item-tile__mat">{doc.thumb_url !== null && <img src={doc.thumb_url} alt="" loading="lazy" />}</span>
      <span className="item-tile__kind">
        <Icon name="document" size="xs" />
        {documentBadge(doc)}
      </span>
    </>
  );
}

function PhotoThumb({ photo }: { photo: PhotoSummary }) {
  return (
    <>
      {photo.thumb_url === null ? (
        <span className="mac-clip-tile__placeholder" aria-hidden="true">
          <Icon name="camera" size="lg" />
        </span>
      ) : (
        <img className="mac-clip-tile__img" src={photo.thumb_url} alt="" loading="lazy" />
      )}
      <span className="item-tile__kind">{PHOTO_COPY.photo}</span>
      {isPhotoBusy(photo.status) && <span className="item-tile__busy">{PHOTO_COPY.analysing}</span>}
    </>
  );
}

/**
 * The tile.
 * @param props - See `MacItemTileProps`.
 * @returns The grid item.
 */
export function MacItemTile({ item, isSelected, isSelecting, onClick, onOpen, onContextMenu, onDragStart }: MacItemTileProps) {
  const title = itemTitle(item);
  return (
    <li className="mac-clip-tile">
      <button
        type="button"
        className={isSelected ? 'mac-clip-tile__thumb mac-clip-tile__thumb--selected item-tile' : 'mac-clip-tile__thumb item-tile'}
        aria-label={title}
        aria-current={isSelected ? 'true' : undefined}
        draggable
        onClick={onClick}
        onDoubleClick={onOpen}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
      >
        {item.kind === 'recording' ? <RecordingThumb listen={item.listen} /> : item.kind === 'photo' ? <PhotoThumb photo={item.photo} /> : <DocumentThumb doc={item.doc} />}
        {isSelecting && <SelectTick isOn={isSelected} className="mac-clip-tile__tick" />}
      </button>
      <span className="mac-clip-tile__caption">{title}</span>
      <span className="mac-clip-tile__sub">{itemTileLine(item)}</span>
    </li>
  );
}
