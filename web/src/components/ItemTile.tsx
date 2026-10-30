// A photo, a recording or a document in the phone Library's day grid (mocks GalleryMixedMock,
// PhotosMock): the clip tile's frame with a photo and its "Photo" badge, a recording's cover (or the wave), "♪ Recording", its score and languages, or a
// document's first page on a dark mat with its kind. A tap opens its photo, iListen or iRead page; in
// Select mode a tap ticks it, and a long press starts Select mode, as on a clip.
import { Link } from 'react-router';
import { documentBadge, itemRef, itemTitle, recordingChips, type GalleryItem } from '../core/gallery-items';
import { isPhotoBusy, PHOTO_COPY } from '../core/photos';
import { formatDuration } from '../core/format';
import { isListenBusy, listenPill } from '../core/ilisten/listens';
import { Icon } from '../design/Icon';
import { useLongPress } from '../hooks/useLongPress';
import { itemPagePath } from '../hooks/gallery-paths';
import './ClipTile.css';
import './ItemTile.css';

/** The waveform tile a recording shows until it has a cover (the Mac tile draws it too). */
export function WaveArt() {
  return (
    <span className="item-tile__wave" aria-hidden="true">
      <Icon name="wave" size="lg" />
    </span>
  );
}

/** Props for `ItemTile`. */
export interface ItemTileProps {
  item: Exclude<GalleryItem, { kind: 'video' }>;
  /** Select mode: whether it is ticked; null when the Library is not selecting. */
  isPicked: boolean | null;
  onPick: () => void;
  onHold: () => void;
}

/**
 * The tile.
 * @param props - See `ItemTileProps`.
 * @returns The grid item.
 */
export function ItemTile({ item, isPicked, onPick, onHold }: ItemTileProps) {
  const press = useLongPress(onHold);
  const title = itemTitle(item);
  const to = itemPagePath(itemRef(item.id));
  return (
    <li>
      <Link
        className={isPicked === true ? 'clip-tile clip-tile--picked' : 'clip-tile'}
        to={to}
        aria-label={isPicked === null ? title : `${title}, ${isPicked ? 'selected' : 'not selected'}`}
        onPointerDown={press.onPointerDown}
        onPointerMove={press.onPointerMove}
        onPointerUp={press.onPointerUp}
        onPointerCancel={press.onPointerCancel}
        onContextMenu={press.onContextMenu}
        onClick={(click) => {
          if (press.swallowClick(click) || isPicked === null) return;
          click.preventDefault();
          onPick();
        }}
      >
        {item.kind === 'recording' ? (
          <>
            {item.listen.cover_url === null ? <WaveArt /> : <img className="clip-tile__img" src={item.listen.cover_url} alt="" loading="lazy" />}
            <span className="item-tile__kind">
              <Icon name="wave" size="xs" />
            </span>
            <span className={`item-tile__score item-tile__score--${listenPill(item.listen, true).tone}`}>{listenPill(item.listen, true).label}</span>
            {recordingChips(item.listen).length > 0 && (
              <span className="item-tile__langs">
                {recordingChips(item.listen).map((chip) => (
                  <span key={chip} className="item-tile__lang">
                    {chip}
                  </span>
                ))}
              </span>
            )}
            {item.listen.duration_ms !== null && !isListenBusy(item.listen.status) && (
              <span className="clip-tile__duration item-tile__duration">{formatDuration(item.listen.duration_ms / 1000)}</span>
            )}
          </>
        ) : item.kind === 'photo' ? (
          <>
            {item.photo.thumb_url !== null && <img className="clip-tile__img" src={item.photo.thumb_url} alt="" loading="lazy" />}
            <span className="item-tile__kind">{PHOTO_COPY.photo}</span>
            {isPhotoBusy(item.photo.status) && <span className="item-tile__busy">{PHOTO_COPY.analysing}</span>}
          </>
        ) : (
          <>
            <span className="item-tile__mat">{item.doc.thumb_url !== null && <img src={item.doc.thumb_url} alt="" loading="lazy" />}</span>
            <span className="item-tile__kind">
              <Icon name="document" size="xs" />
              {documentBadge(item.doc)}
            </span>
          </>
        )}
        {isPicked !== null && (
          <span className={isPicked ? 'clip-tile__tick clip-tile__tick--on' : 'clip-tile__tick'} aria-hidden="true">
            {isPicked && <Icon name="check" size="sm" />}
          </span>
        )}
      </Link>
    </li>
  );
}
