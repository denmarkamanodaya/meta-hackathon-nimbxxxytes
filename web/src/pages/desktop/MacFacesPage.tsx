// Faces on the Mac (redesign v2, V5): the header with how many faces there are and the "Suggest
// matches" switch, the All / Named / Not named / Hidden chips, every face as a square card, and the
// selected face on the right: "Who is this?" with Save, where it is seen, "Hide this face" (blurred
// in shorts and previews), "Make a short with this face", "Same person as…" and "Not a face".
// A named person can't be renamed, hidden or merged from here yet (the API works on faces, not on
// people), and there is no API to say a face is not a face, so those controls are disabled.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { NAV_COPY } from '../../core/copy';
import { FACE_FILTERS, faceCounts, faceItems, facesLine, faceSpan, filterFaces, type FaceFilter, type FaceItem } from '../../core/face-list';
import { libraryQueryPath } from '../../core/library-query';
import { handoffFromRange, type EditorHandoff } from '../../core/selection';
import { Icon } from '../../design/Icon';
import { Skeleton } from '../../design/Skeleton';
import { Toggle } from '../../design/Toggle';
import { LoadError } from '../../components/LoadError';
import { MacColumns } from '../../components/desktop/MacColumns';
import { useClipDetails } from '../../hooks/useClips';
import { useNameFaces, usePeopleOverview, useSettings, useTrackVisibility } from '../../hooks/useOverview';
import type { ClipDetail, NamedPerson, PeopleOverview, Track } from '../../services/api/types';
import './MacFacesPage.css';

/** A face's track in its clip, once the clip has loaded. */
const trackOf = (item: FaceItem, details: ReadonlyMap<string, ClipDetail>): Track | null => {
  if (item.clipId === null || item.trackId === null) return null;
  return details.get(item.clipId)?.tracks.find((t) => t.track_id === item.trackId) ?? null;
};

function SuggestSwitch() {
  const { state, setFaceMatching } = useSettings();
  const isReady = state.status === 'ready';
  return (
    <span className="mac-faces__suggest">
      Suggest matches
      <Toggle
        checked={isReady && state.faceMatching}
        disabled={!isReady || state.isSaving}
        label="Suggest matching faces"
        onChange={(next) => {
          void setFaceMatching(next);
        }}
      />
    </span>
  );
}

function FaceCrop({ item, className, glyph }: { item: FaceItem; className: string; glyph: string }) {
  return (
    <span className={className}>
      {item.cropUrl === null ? (
        <span className={glyph}>
          <Icon name="person" />
        </span>
      ) : (
        <img src={item.cropUrl} alt="" />
      )}
    </span>
  );
}

interface CardProps {
  item: FaceItem;
  track: Track | null;
  isSelected: boolean;
  onSelect: () => void;
}

function FaceCard({ item, track, isSelected, onSelect }: CardProps) {
  const name = item.name ?? 'Name?';
  const when = item.kind === 'named' ? `${String(item.clipCount)} ${item.clipCount === 1 ? 'clip' : 'clips'}` : track === null ? '' : faceSpan(track.first_s, track.first_s);
  return (
    <li className="mac-faces__card">
      <button
        type="button"
        className={isSelected ? 'mac-faces__face mac-faces__face--on' : 'mac-faces__face'}
        aria-label={item.name === null ? `Face${when === '' ? '' : ` at ${when}`}, not named` : item.name}
        aria-pressed={isSelected}
        onClick={onSelect}
      >
        <FaceCrop item={item} className="mac-faces__crop" glyph="mac-faces__glyph" />
      </button>
      <span className={item.name === null ? 'mac-faces__name' : 'mac-faces__name mac-faces__name--set'}>{name}</span>
      {when !== '' && <span className="mac-faces__when">{when}</span>}
    </li>
  );
}

interface PanelProps {
  item: FaceItem;
  track: Track | null;
  detail: ClipDetail | undefined;
  people: NamedPerson[];
  refresh: () => void;
}

function FacePanel({ item, track, detail, people, refresh }: PanelProps) {
  const navigate = useNavigate();
  const nameFaces = useNameFaces(refresh);
  const setHidden = useTrackVisibility(refresh);
  const [name, setName] = useState(item.name ?? item.suggested?.name ?? '');
  const trackId = item.trackId;
  const isFace = trackId !== null;
  const handoff: EditorHandoff | null =
    detail === undefined || track === null ? null : handoffFromRange(detail, { start_s: track.first_s, end_s: track.last_s });
  const canMakeShort = item.kind === 'named' ? item.name !== null : handoff !== null && handoff.segmentIds.length > 0;
  const save = () => {
    if (trackId !== null && name.trim() !== '') void nameFaces([trackId], name.trim());
  };
  return (
    <div className="mac-faces__panel">
      <FaceCrop item={item} className="mac-faces__big" glyph="mac-faces__big-glyph" />
      <form
        className="mac-faces__who"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <label className="mac-faces__who-label" htmlFor="mac-faces-name">
          Who is this?
        </label>
        <span className="mac-faces__who-row">
          <input
            id="mac-faces-name"
            className="mac-faces__input"
            type="text"
            placeholder="Name"
            value={name}
            disabled={!isFace}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
          <button type="submit" className="mac-faces__save" disabled={!isFace || name.trim() === ''}>
            Save
          </button>
        </span>
      </form>
      <div className="mac-faces__seen">
        <span className="mac-faces__label">Seen in</span>
        {item.kind === 'named' && item.name !== null ? (
          <Link className="mac-faces__seen-row" to={libraryQueryPath(item.name)}>
            <span className="mac-faces__seen-thumb" />
            <span className="mac-faces__seen-text">
              <span className="mac-faces__seen-title">{`${String(item.clipCount)} ${item.clipCount === 1 ? 'clip' : 'clips'}`}</span>
              <span className="mac-faces__seen-time">{`Search for ${item.name}`}</span>
            </span>
          </Link>
        ) : (
          item.clipId !== null && (
            <Link className="mac-faces__seen-row" to={`/clips/${encodeURIComponent(item.clipId)}${track === null ? '' : `?t=${String(track.first_s)}`}`}>
              <span className="mac-faces__seen-thumb">{detail?.clip.thumb_url != null && <img src={detail.clip.thumb_url} alt="" />}</span>
              <span className="mac-faces__seen-text">
                <span className="mac-faces__seen-title">{item.clipTitle}</span>
                {track !== null && <span className="mac-faces__seen-time">{faceSpan(track.first_s, track.last_s)}</span>}
              </span>
            </Link>
          )
        )}
      </div>
      <div className="mac-faces__hide">
        <span className="mac-faces__hide-text">
          <span className="mac-faces__hide-title">Hide this face</span>
          <span className="mac-faces__muted">Blurred in shorts and previews</span>
        </span>
        <Toggle
          checked={item.kind === 'hidden'}
          disabled={!isFace}
          label="Hide this face"
          onChange={(next) => {
            if (trackId !== null) void setHidden(trackId, next);
          }}
        />
      </div>
      <div className="mac-faces__spacer" />
      <button
        type="button"
        className="mac-faces__make"
        disabled={!canMakeShort}
        onClick={() => {
          if (item.kind === 'named' && item.name !== null) void navigate(libraryQueryPath(item.name));
          else if (handoff !== null) void navigate('/editor', { state: handoff });
        }}
      >
        Make a short with this face
      </button>
      <div className="mac-faces__pair">
        <select
          className="mac-faces__secondary mac-faces__same"
          aria-label="Same person as"
          value=""
          disabled={!isFace || people.length === 0}
          onChange={(event) => {
            const person = people.find((p) => p.person_id === event.target.value);
            if (person !== undefined && trackId !== null) void nameFaces([trackId], person.name);
          }}
        >
          <option value="" disabled>
            Same person as…
          </option>
          {people.map((person) => (
            <option key={person.person_id} value={person.person_id}>
              {person.name}
            </option>
          ))}
        </select>
        <button type="button" className="mac-faces__secondary" disabled>
          Not a face
        </button>
      </div>
    </div>
  );
}

function FacesBody({ overview, refresh }: { overview: PeopleOverview; refresh: () => void }) {
  const items = faceItems(overview);
  const counts = faceCounts(items);
  const [filter, setFilter] = useState<FaceFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const shown = filterFaces(items, filter);
  const details = useClipDetails(items.flatMap((item) => (item.clipId === null ? [] : [item.clipId])));
  const selected = shown.find((item) => item.key === selectedKey) ?? shown[0] ?? null;
  return (
    <MacColumns
      asideLabel="Selected face"
      aside={
        selected === null ? null : (
          <FacePanel
            key={selected.key}
            item={selected}
            track={trackOf(selected, details)}
            detail={selected.clipId === null ? undefined : details.get(selected.clipId)}
            people={overview.people}
            refresh={refresh}
          />
        )
      }
    >
      <header className="mac-columns__head mac-faces__head">
        <h1 className="mac-faces__title">{NAV_COPY.faces}</h1>
        <span className="mac-faces__muted">{facesLine(items)}</span>
        <div className="mac-faces__spacer" />
        <SuggestSwitch />
      </header>
      <div className="mac-faces__chips" role="group" aria-label="Show">
        {FACE_FILTERS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            className="mac-faces__chip"
            aria-pressed={chip.value === filter}
            onClick={() => {
              setFilter(chip.value);
            }}
          >
            {`${chip.label} ${String(counts[chip.value])}`}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="mac-faces__empty mac-faces__muted">No faces here yet.</p>
      ) : (
        <ul className="mac-faces__grid">
          {shown.map((item) => (
            <FaceCard
              key={item.key}
              item={item}
              track={trackOf(item, details)}
              isSelected={item.key === selected?.key}
              onSelect={() => {
                setSelectedKey(item.key);
              }}
            />
          ))}
        </ul>
      )}
    </MacColumns>
  );
}

/**
 * The Faces page.
 * @returns The page.
 */
export function MacFacesPage() {
  const { state, refresh } = usePeopleOverview();
  if (state.status === 'ready') return <FacesBody overview={state.data} refresh={refresh} />;
  return (
    <MacColumns asideLabel="Selected face" aside={null}>
      <header className="mac-columns__head mac-faces__head">
        <h1 className="mac-faces__title">{NAV_COPY.faces}</h1>
      </header>
      {state.status === 'loading' && (
        <div className="mac-faces__empty" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading faces…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="faces" onRetry={refresh} />}
    </MacColumns>
  );
}
