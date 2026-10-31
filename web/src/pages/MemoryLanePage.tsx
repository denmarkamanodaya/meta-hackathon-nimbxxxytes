// Memory Lane's start (`/memory-lane`, mock frame 1), always in the Night theme and at the app's
// normal density: the "For ‹viewer›" chip (who watches; "you" in the lines), one face tile per
// named person and "A day" (pick a clip), Start, then the past sessions. The phone shows the
// Accessibility switch above it; the Mac lists Memory Lane in its sidebar instead.
import { useState } from 'react';
import { Link } from 'react-router';
import { FeaturesSwitch } from '../components/FeaturesSwitch';
import { LoadError } from '../components/LoadError';
import { MEMORY_COPY, memoryFacts, memoryTitle } from '../core/memory-lane/memories';
import { buttonClassName } from '../design/Button';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Skeleton } from '../design/Skeleton';
import { Spinner } from '../design/Spinner';
import { useClips } from '../hooks/useClips';
import { memoryPath, useMemories, useStartMemory } from '../hooks/useMemories';
import { usePeopleOverview } from '../hooks/useOverview';
import type { ClipSummary, CreateMemoryRequest, MemorySummary, NamedPerson } from '../services/api/types';
import './GuidesPage.css';
import './MemoryLanePage.css';

/** What Start would start: a person, or a day (one clip). */
type Subject = { kind: 'person'; id: string; name: string } | { kind: 'clip'; id: string; name: string };

const requestFor = (subject: Subject, viewerId: string | null): CreateMemoryRequest => ({
  person_id: subject.kind === 'person' ? subject.id : null,
  clip_id: subject.kind === 'clip' ? subject.id : null,
  viewer_id: viewerId,
});

function ViewerChip({ people, viewerId, onChange }: { people: readonly NamedPerson[]; viewerId: string | null; onChange: (id: string | null) => void }) {
  const viewer = people.find((person) => person.person_id === viewerId);
  return (
    <label className="memory-lane__viewer">
      {viewer?.crop_url != null ? <img src={viewer.crop_url} alt="" /> : <Icon name="person" size="sm" />}
      <span>{`${MEMORY_COPY.forViewer} ${viewer?.name ?? MEMORY_COPY.nobody}`}</span>
      <Icon name="chevron-down" size="xs" />
      <select
        aria-label="Who is watching"
        value={viewerId ?? ''}
        onChange={(event) => {
          onChange(event.target.value === '' ? null : event.target.value);
        }}
      >
        <option value="">{MEMORY_COPY.nobody}</option>
        {people.map((person) => (
          <option key={person.person_id} value={person.person_id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function PersonTile({ person, isPicked, onPick }: { person: NamedPerson; isPicked: boolean; onPick: () => void }) {
  return (
    <button type="button" className="memory-lane__tile" aria-pressed={isPicked} onClick={onPick}>
      <span className="memory-lane__face">{person.crop_url === null ? <Icon name="person" size="lg" /> : <img src={person.crop_url} alt="" />}</span>
      <span className="memory-lane__tile-name">{person.name}</span>
      <span className="memory-lane__tile-line">{`${String(person.clip_count)} ${person.clip_count === 1 ? 'clip' : 'clips'}`}</span>
    </button>
  );
}

function DayTile({ clips, picked, onPick }: { clips: readonly ClipSummary[]; picked: ClipSummary | undefined; onPick: (clip: ClipSummary) => void }) {
  return (
    <label className="memory-lane__tile memory-lane__tile--day" data-picked={picked !== undefined}>
      <span className="memory-lane__face">{picked?.thumb_url != null ? <img src={picked.thumb_url} alt="" /> : <Icon name="clock" size="lg" />}</span>
      <span className="memory-lane__tile-name">{MEMORY_COPY.aDay}</span>
      <span className="memory-lane__tile-line">{picked?.title ?? MEMORY_COPY.pickDay}</span>
      <select
        aria-label={MEMORY_COPY.pickDay}
        value={picked?.clip_id ?? ''}
        onChange={(event) => {
          const clip = clips.find((each) => each.clip_id === event.target.value);
          if (clip !== undefined) onPick(clip);
        }}
      >
        <option value="" disabled>
          {MEMORY_COPY.pickDay}
        </option>
        {clips.map((clip) => (
          <option key={clip.clip_id} value={clip.clip_id}>
            {clip.title}
          </option>
        ))}
      </select>
    </label>
  );
}

function PastRow({ memory }: { memory: MemorySummary }) {
  return (
    <li>
      <Link className="guides-page__row" to={memoryPath(memory.id)}>
        <span className="guides-page__thumb memory-lane__row-thumb">{memory.cover_url === null ? <Icon name="face" size="md" /> : <img src={memory.cover_url} alt="" />}</span>
        <span className="guides-page__text">
          <span className="guides-page__title">{memoryTitle(memory)}</span>
          <span className="memory-lane__muted">{memoryFacts(memory)}</span>
        </span>
        {memory.status === 'making' && <Spinner />}
      </Link>
    </li>
  );
}

function Past() {
  const { state, refresh } = useMemories();
  return (
    <section className="memory-lane__past" aria-label={MEMORY_COPY.pastSessions}>
      <h2 className="memory-lane__group">{MEMORY_COPY.pastSessions}</h2>
      {state.status === 'loading' && <Skeleton kind="line" />}
      {state.status === 'error' && <LoadError error={state.error} thing="sessions" onRetry={refresh} />}
      {state.status === 'ready' && state.data.length === 0 && <p className="memory-lane__muted">{MEMORY_COPY.emptyPast}</p>}
      {state.status === 'ready' && state.data.length > 0 && (
        <ul className="guides-page__list">
          {state.data.map((memory) => (
            <PastRow key={memory.id} memory={memory} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Start() {
  const { state: people, refresh } = usePeopleOverview();
  const { state: clips } = useClips();
  const { start, isStarting } = useStartMemory();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [subject, setSubject] = useState<Subject | null>(null);
  const named = people.status === 'ready' ? people.data.people : [];
  const days = clips.status === 'ready' ? clips.data.filter((clip) => clip.status === 'ready') : [];
  const pickedDay = subject?.kind === 'clip' ? days.find((clip) => clip.clip_id === subject.id) : undefined;
  return (
    <section className="memory-lane__start">
      <ViewerChip people={named} viewerId={viewerId} onChange={setViewerId} />
      <h2 className="memory-lane__title">{MEMORY_COPY.startTitle}</h2>
      <p className="memory-lane__muted">{MEMORY_COPY.startBody}</p>
      {people.status === 'loading' && <Skeleton kind="line" />}
      {people.status === 'error' && <LoadError error={people.error} thing="people" onRetry={refresh} />}
      {people.status === 'ready' && named.length === 0 && <p className="memory-lane__muted">{MEMORY_COPY.noPeople}</p>}
      <div className="memory-lane__tiles">
        {named.map((person) => (
          <PersonTile
            key={person.person_id}
            person={person}
            isPicked={subject?.kind === 'person' && subject.id === person.person_id}
            onPick={() => {
              setSubject({ kind: 'person', id: person.person_id, name: person.name });
            }}
          />
        ))}
        {days.length > 0 && (
          <DayTile
            clips={days}
            picked={pickedDay}
            onPick={(clip) => {
              setSubject({ kind: 'clip', id: clip.clip_id, name: clip.title });
            }}
          />
        )}
      </div>
      <div className="memory-lane__actions">
        <button
          type="button"
          className={buttonClassName('primary')}
          disabled={subject === null || isStarting}
          onClick={() => {
            if (subject !== null) void start(requestFor(subject, viewerId));
          }}
        >
          {isStarting ? <Spinner /> : null}
          {isStarting ? MEMORY_COPY.starting : subject === null ? MEMORY_COPY.start : `${MEMORY_COPY.start} with ${subject.name}`}
        </button>
      </div>
    </section>
  );
}

/**
 * The page on the phone: the Accessibility switch, then the start and the past sessions.
 * @returns Memory Lane's start.
 */
export function MemoryLanePage() {
  return (
    <div className="theme-night memory-lane memory-lane--phone">
      <PageHeader title={MEMORY_COPY.section} />
      <FeaturesSwitch view="memoryLane" />
      <Start />
      <Past />
    </div>
  );
}

/**
 * The page on the Mac (the sidebar lists Memory Lane, so no switch).
 * @returns Memory Lane's start.
 */
export function MacMemoryLanePage() {
  return (
    <div className="theme-night memory-lane memory-lane--mac">
      <PageHeader title={MEMORY_COPY.section} />
      <Start />
      <Past />
    </div>
  );
}

