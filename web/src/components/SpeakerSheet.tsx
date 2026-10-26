// Bottom sheet to rename a transcript speaker.
import { useId, useState } from 'react';
import { speakerName } from '../core/clip-view';
import { Button } from '../design/Button';
import { Sheet } from '../design/Sheet';
import type { Speaker } from '../services/api/types';
import { NameField } from './NameField';
import './NamingSheet.css';

/** Props for `SpeakerSheet`. */
export interface SpeakerSheetProps {
  /** The speaker being renamed; null keeps the sheet closed. */
  speaker: Speaker | null;
  onClose: () => void;
  onRename: (speaker: Speaker, displayName: string) => void;
}

function SpeakerForm({ speaker, onClose, onRename }: SpeakerSheetProps & { speaker: Speaker }) {
  const [name, setName] = useState(speaker.display_name ?? '');
  const fieldId = useId();
  const clean = name.trim();

  return (
    <form
      className="naming-sheet"
      onSubmit={(event) => {
        event.preventDefault();
        if (clean === '') return;
        onRename(speaker, clean);
        onClose();
      }}
    >
      <NameField
        id={fieldId}
        label={`Who is ${speakerName(speaker)}?`}
        value={name}
        onChange={setName}
        placeholder="Name"
      />
      <Button type="submit" disabled={clean === '' || clean === speaker.display_name}>
        Save name
      </Button>
    </form>
  );
}

/**
 * Rename sheet for one speaker; the form remounts per speaker.
 * @param props - See `SpeakerSheetProps`.
 * @returns The sheet.
 */
export function SpeakerSheet(props: SpeakerSheetProps) {
  const { speaker, onClose } = props;
  return (
    <Sheet open={speaker !== null} onClose={onClose} title="Name this speaker">
      {speaker !== null && <SpeakerForm key={speaker.speaker_id} {...props} speaker={speaker} />}
    </Sheet>
  );
}
