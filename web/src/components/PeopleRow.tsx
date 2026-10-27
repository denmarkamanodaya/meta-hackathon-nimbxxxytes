// The clip's People row (Mist): a 52 px face crop per visible track with its name; an unnamed
// face shows a dashed ring and "Name?" in the accent. Tapping a face opens the naming sheet.
import type { Track } from '../services/api/types';
import './PeopleRow.css';

/** Props for `PeopleRow`. */
export interface PeopleRowProps {
  /** Visible tracks, in order of first appearance. */
  tracks: readonly Track[];
  /** Opens the naming sheet for this face. */
  onSelect: (track: Track) => void;
}

/**
 * The row.
 * @param props - See `PeopleRowProps`.
 * @returns The list.
 */
export function PeopleRow({ tracks, onSelect }: PeopleRowProps) {
  return (
    <ul className="people-row">
      {tracks.map((track) => {
        const isUnnamed = track.person_name === null;
        return (
          <li key={track.track_id}>
            <button
              type="button"
              className={isUnnamed ? 'people-row__person people-row__person--unnamed' : 'people-row__person'}
              aria-label={isUnnamed ? 'Name this face' : `${track.person_name ?? ''}. Edit name`}
              onClick={() => {
                onSelect(track);
              }}
            >
              <span className="people-row__avatar">
                {track.crop_url !== null && <img src={track.crop_url} alt="" loading="lazy" />}
              </span>
              <span className="people-row__name">{track.person_name ?? 'Name?'}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
