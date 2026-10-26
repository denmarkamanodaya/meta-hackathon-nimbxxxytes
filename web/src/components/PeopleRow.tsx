// "People in this clip": one face crop per visible track; tapping one opens the naming sheet.
import { formatDuration } from '../core/format';
import { Icon } from '../design/Icon';
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
 * Round face crops with names (or "Unnamed"), scrollable sideways.
 * @param props - See `PeopleRowProps`.
 * @returns The list.
 */
export function PeopleRow({ tracks, onSelect }: PeopleRowProps) {
  return (
    <ul className="people-row">
      {tracks.map((track) => {
        const name = track.person_name ?? 'Unnamed';
        return (
          <li key={track.track_id}>
            <button
              type="button"
              className="people-row__person"
              aria-label={`${name}, first seen at ${formatDuration(track.first_s)}. Edit name`}
              onClick={() => {
                onSelect(track);
              }}
            >
              <span className="people-row__avatar">
                {track.crop_url === null ? (
                  <Icon name="person" />
                ) : (
                  <img className="people-row__img" src={track.crop_url} alt="" loading="lazy" />
                )}
              </span>
              <span
                className={`people-row__name${track.person_name === null ? ' people-row__name--unnamed' : ''}`}
              >
                {name}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
