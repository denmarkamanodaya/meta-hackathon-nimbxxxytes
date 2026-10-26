// Bottom sheet to name a face (with autocomplete of known names) or hide it as a bystander.
import { useId, useState } from 'react';
import { formatDuration } from '../core/format';
import { Button } from '../design/Button';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import { Sheet } from '../design/Sheet';
import { usePeopleSuggestions } from '../hooks/useSearch';
import type { Track } from '../services/api/types';
import { NameField } from './NameField';
import './NamingSheet.css';

/** Props for `PersonSheet`. */
export interface PersonSheetProps {
  /** The face being named; null keeps the sheet closed. */
  track: Track | null;
  onClose: () => void;
  onName: (track: Track, name: string) => void;
  onHide: (track: Track) => void;
  onPlay: (seconds: number) => void;
}

function PersonForm({ track, onClose, onName, onHide, onPlay }: PersonSheetProps & { track: Track }) {
  const [name, setName] = useState(track.person_name ?? '');
  const fieldId = useId();
  const clean = name.trim();
  const suggestions = usePeopleSuggestions(name).filter((person) => person.name !== clean);
  const save = (value: string) => {
    onName(track, value);
    onClose();
  };

  return (
    <form
      className="naming-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (clean !== '') save(clean);
      }}
    >
      <div className="naming-sheet__face">
        {track.crop_url === null ? (
          <Icon name="person" />
        ) : (
          <img className="naming-sheet__img" src={track.crop_url} alt="" />
        )}
      </div>
      <NameField id={fieldId} label="Who is this?" value={name} onChange={setName} placeholder="Name" />
      {suggestions.length > 0 && (
        <div className="naming-sheet__suggestions" aria-label="Known people">
          {suggestions.map((person) => (
            <Chip
              key={person.person_id}
              onClick={() => {
                save(person.name);
              }}
            >
              {person.name}
            </Chip>
          ))}
        </div>
      )}
      <Button type="submit" disabled={clean === '' || clean === track.person_name}>
        Save name
      </Button>
      <div className="naming-sheet__row">
        <Button
          variant="ghost"
          onClick={() => {
            onPlay(track.first_s);
            onClose();
          }}
        >
          <Icon name="play" />
          {`Play from ${formatDuration(track.first_s)}`}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onHide(track);
            onClose();
          }}
        >
          <Icon name="close" />
          Hide (bystander)
        </Button>
      </div>
    </form>
  );
}

/**
 * Naming sheet for one face track. The form remounts per track, so it starts from that
 * track's current name.
 * @param props - See `PersonSheetProps`.
 * @returns The sheet.
 */
export function PersonSheet(props: PersonSheetProps) {
  const { track, onClose } = props;
  return (
    <Sheet open={track !== null} onClose={onClose} title="Name this person">
      {track !== null && <PersonForm key={track.track_id} {...props} track={track} />}
    </Sheet>
  );
}
