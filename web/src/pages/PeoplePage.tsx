// People & pets (Mist): faces waiting for a name ("Who's this?"), one card per face group with
// "Is this ‹name›?" when matching suggests someone, else Name and Hide; the named grid; and the
// hidden bystanders (opens a sheet to unhide them).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LoadError } from '../components/LoadError';
import { PersonSheet } from '../components/PersonSheet';
import { dayLabel } from '../core/day-groups';
import { faceCards, type FaceCard } from '../core/face-groups';
import { formatDuration } from '../core/format';
import { Button } from '../design/Button';
import { Icon } from '../design/Icon';
import { PageHeader } from '../design/PageHeader';
import { Sheet } from '../design/Sheet';
import { Skeleton } from '../design/Skeleton';
import {
  useDismissedMatches,
  useHideFaces,
  useNameFaces,
  usePeopleOverview,
  useTrackVisibility,
} from '../hooks/useOverview';
import type { HiddenFace, NamedPerson, PeopleOverview, Track, UnnamedFace } from '../services/api/types';
import './PeoplePage.css';

/** The naming sheet works on tracks; a card is named through its first face. */
const asTrack = (face: UnnamedFace): Track => ({
  track_id: face.track_id,
  crop_url: face.crop_url,
  first_s: 0,
  last_s: face.on_screen_s,
  person_name: null,
  hidden: false,
});

const idsOf = (card: FaceCard) => card.faces.map((f) => f.track_id);

function Crops({ card }: { card: FaceCard }) {
  const shown = card.faces.slice(0, 3);
  return (
    <span className={shown.length > 1 ? 'people-page__stack' : 'people-page__square'}>
      {shown.map((face) => (
        <span key={face.track_id} className="people-page__stack-crop">
          {face.crop_url !== null && <img src={face.crop_url} alt="" />}
        </span>
      ))}
    </span>
  );
}

function cardMeta(card: FaceCard, now: Date): string {
  if (card.clipCount > 1) return `in ${String(card.clipCount)} clips`;
  const [face] = card.faces;
  if (face === undefined) return '';
  const day = face.recorded_at === null ? '' : dayLabel(face.recorded_at, now);
  const onScreen = card.faces.reduce((sum, f) => sum + f.on_screen_s, 0);
  return `${day === '' ? '' : `${day} · `}on screen ${formatDuration(onScreen)}`;
}

interface QueueProps {
  cards: FaceCard[];
  now: Date;
  onName: (card: FaceCard) => void;
  onHide: (card: FaceCard) => void;
  onConfirm: (card: FaceCard, name: string) => void;
  onDismiss: (card: FaceCard) => void;
}

function Queue({ cards, now, onName, onHide, onConfirm, onDismiss }: QueueProps) {
  return (
    <section className="people-page__section" aria-label="Who is this">
      <h2 className="people-page__heading">
        Who’s this? <span className="people-page__count">{`${String(cards.length)} new ${cards.length === 1 ? 'face' : 'faces'}`}</span>
      </h2>
      <ul className="people-page__queue">
        {cards.map((card) => {
          const title = card.faces[0]?.clip_title ?? '';
          const suggested = card.suggested;
          return (
            <li key={card.key} className={suggested === null ? 'people-page__who' : 'people-page__who people-page__who--ask'}>
              <span className="people-page__who-row">
                <Crops card={card} />
                <span className="people-page__who-text">
                  <span className="people-page__who-title">{suggested === null ? title : `Is this ${suggested.name}?`}</span>
                  <span className="people-page__who-meta">{suggested === null ? cardMeta(card, now) : `${title} · ${cardMeta(card, now)}`}</span>
                </span>
                {suggested === null && (
                  <>
                    <Button
                      onClick={() => {
                        onName(card);
                      }}
                    >
                      Name
                    </Button>
                    <button
                      type="button"
                      className="people-page__hide"
                      aria-label={card.faces.length > 1 ? 'Hide these faces' : 'Hide this face'}
                      onClick={() => {
                        onHide(card);
                      }}
                    >
                      <Icon name="hide" size="sm" />
                    </button>
                  </>
                )}
              </span>
              {suggested !== null && (
                <span className="people-page__ask">
                  <Button
                    onClick={() => {
                      onConfirm(card, suggested.name);
                    }}
                  >
                    {`Yes, ${suggested.name}`}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      onDismiss(card);
                    }}
                  >
                    Not them
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function YourPeople({ people }: { people: NamedPerson[] }) {
  return (
    <section className="people-page__section people-page__section--named" aria-label="Named people">
      <h2 className="people-page__heading">Your people</h2>
      {people.length === 0 ? (
        <p className="people-page__muted">Name a face above, a person’s or a pet’s, and they show up here, searchable by name.</p>
      ) : (
        <ul className="people-page__grid">
          {people.map((person) => (
            <li key={person.person_id}>
              <Link className="people-page__person" to={`/search?q=${encodeURIComponent(person.name)}`}>
                <span className="people-page__face">{person.crop_url !== null && <img src={person.crop_url} alt="" />}</span>
                <span className="people-page__name">{person.name}</span>
                <span className="people-page__clips">{`${String(person.clip_count)} ${person.clip_count === 1 ? 'clip' : 'clips'}`}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HiddenSheet({ open, hidden, onClose, onUnhide }: { open: boolean; hidden: HiddenFace[]; onClose: () => void; onUnhide: (id: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Hidden bystanders">
      {hidden.length === 0 ? (
        <p className="people-page__muted">Hidden faces will be listed here.</p>
      ) : (
        <ul className="people-page__queue">
          {hidden.map((face) => (
            <li key={face.track_id} className="people-page__who people-page__who-row">
              <span className="people-page__square">{face.crop_url !== null && <img src={face.crop_url} alt="" />}</span>
              <span className="people-page__who-text">
                <span className="people-page__who-title">{face.clip_title}</span>
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  onUnhide(face.track_id);
                }}
              >
                Unhide
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function PeopleBody({ overview, refresh }: { overview: PeopleOverview; refresh: () => void }) {
  const now = useMemo(() => new Date(), []);
  const setHidden = useTrackVisibility(refresh);
  const nameAll = useNameFaces(refresh);
  const hideAll = useHideFaces(refresh);
  const { dismissed, dismiss } = useDismissedMatches();
  const cards = useMemo(() => faceCards(overview.unnamed, dismissed), [overview.unnamed, dismissed]);
  const [naming, setNaming] = useState<FaceCard | null>(null);
  const [isHiddenOpen, setHiddenOpen] = useState(false);
  const firstFace = naming?.faces[0];
  return (
    <>
      {cards.length > 0 && (
        <Queue
          cards={cards}
          now={now}
          onName={setNaming}
          onHide={(card) => {
            void hideAll(idsOf(card));
          }}
          onConfirm={(card, name) => {
            void nameAll(idsOf(card), name);
          }}
          onDismiss={(card) => {
            dismiss(card.key);
          }}
        />
      )}
      <YourPeople people={overview.people} />
      {overview.hidden_count > 0 && (
        <button
          type="button"
          className="people-page__hidden"
          onClick={() => {
            setHiddenOpen(true);
          }}
        >
          <span>
            Hidden bystanders <span className="people-page__count">{`· ${String(overview.hidden_count)}`}</span>
          </span>
          <Icon name="forward" size="sm" />
        </button>
      )}
      <PersonSheet
        track={firstFace === undefined ? null : asTrack(firstFace)}
        onClose={() => {
          setNaming(null);
        }}
        onName={(_track, name) => {
          if (naming !== null) void nameAll(idsOf(naming), name);
        }}
        onHide={() => {
          if (naming !== null) void hideAll(idsOf(naming));
        }}
      />
      <HiddenSheet
        open={isHiddenOpen}
        hidden={overview.hidden}
        onClose={() => {
          setHiddenOpen(false);
        }}
        onUnhide={(id) => {
          void setHidden(id, false);
        }}
      />
    </>
  );
}

/**
 * The People screen.
 * @returns The page.
 */
export function PeoplePage() {
  const { state, refresh } = usePeopleOverview();
  return (
    <div className="people-page">
      <PageHeader
        title="People & pets"
        subtitle="Faces are found in each clip. Turn on matching in Settings to link them."
      />
      {state.status === 'loading' && (
        <div className="people-page__section" aria-busy="true">
          <p className="visually-hidden" role="status">
            Loading people…
          </p>
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="people and pets" onRetry={refresh} />}
      {state.status === 'ready' && <PeopleBody overview={state.data} refresh={refresh} />}
    </div>
  );
}
