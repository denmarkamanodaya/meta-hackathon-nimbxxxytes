// People & pets (P4): the inline "Suggest matches" switch; faces waiting for a name ("Who's
// this?") as face-first cards with Name and a labelled Hide, and an "Is this ‹name›?" card when
// matching suggests someone; the named people and pets; and the hidden bystanders (a sheet to
// unhide them).
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { FaceMatchingSwitch } from '../components/FaceMatchingSwitch';
import { LoadError } from '../components/LoadError';
import { PersonSheet } from '../components/PersonSheet';
import { NAV_COPY } from '../core/copy';
import { faceCardLine, faceCards, matchLine, type FaceCard } from '../core/face-groups';
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

/** Face cards shown before "See all". */
const FIRST_CARDS = 6;

function Crop({ card, className }: { card: FaceCard; className: string }) {
  const face = card.faces[0];
  return <span className={className}>{face?.crop_url != null && <img src={face.crop_url} alt="" />}</span>;
}

interface QueueProps {
  cards: FaceCard[];
  onName: (card: FaceCard) => void;
  onHide: (card: FaceCard) => void;
  onConfirm: (card: FaceCard, name: string) => void;
  onDismiss: (card: FaceCard) => void;
}

function Queue({ cards, onName, onHide, onConfirm, onDismiss }: QueueProps) {
  const [isAll, setAll] = useState(false);
  const toName = cards.filter((card) => card.suggested === null);
  const toAsk = cards.filter((card) => card.suggested !== null);
  const shown = isAll ? toName : toName.slice(0, FIRST_CARDS);
  return (
    <section className="people-page__section" aria-labelledby="people-who">
      <div className="people-page__head">
        <h2 className="people-page__heading" id="people-who">
          Who’s this? <span className="people-page__count">{`${String(cards.length)} new`}</span>
        </h2>
        {toName.length > FIRST_CARDS && (
          <button
            type="button"
            className="people-page__all"
            onClick={() => {
              setAll(!isAll);
            }}
          >
            {isAll ? 'Show fewer' : 'See all'}
          </button>
        )}
      </div>
      {shown.length > 0 && (
        <ul className="people-page__cards">
          {shown.map((card) => (
            <li key={card.key} className="people-page__card">
              <Crop card={card} className="people-page__crop" />
              <span className="people-page__card-line">{faceCardLine(card)}</span>
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
                onClick={() => {
                  onHide(card);
                }}
              >
                <Icon name="hide" size="sm" />
                Hide
              </button>
            </li>
          ))}
        </ul>
      )}
      {toAsk.map((card) => {
        const name = card.suggested?.name ?? '';
        return (
          <div key={card.key} className="people-page__ask">
            <Crop card={card} className="people-page__ask-crop" />
            <span className="people-page__ask-text">
              <b>{`Is this ${name}?`}</b>
              <span className="people-page__muted">{matchLine(card)}</span>
            </span>
            <Button
              variant="secondary"
              onClick={() => {
                onDismiss(card);
              }}
            >
              No
            </Button>
            <Button
              onClick={() => {
                onConfirm(card, name);
              }}
            >
              Yes
            </Button>
          </div>
        );
      })}
    </section>
  );
}

function YourPeople({ people }: { people: NamedPerson[] }) {
  return (
    <section className="people-page__section people-page__section--named" aria-label="Named people">
      <div className="people-page__head">
        <h2 className="people-page__heading">Your people &amp; pets</h2>
        <span className="people-page__count">{people.length}</span>
      </div>
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
      <PageHeader title={NAV_COPY.faces} subtitle="Name a face once. nimbytes finds it in every clip." />
      <FaceMatchingSwitch
        title="Suggest matches"
        description="Perception Encoder spots likely pairs; Muse Spark confirms each one. Off until you switch it on."
        note="Off deletes the face data."
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
