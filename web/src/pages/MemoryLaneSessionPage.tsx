// One Memory Lane session (`/memory-lane/:id`, mock frames 2–4), always in the Night theme: while
// the agent makes it, the four steps (find, write, check, cover) with the moments found and the
// agent-check note; then the session, one moment at a time (its stretch of video with its own
// sound low, the line read aloud, the gentle question, "Who is this?", Again / Next, ← → space);
// then the end ("That was …", the cover, "Checked by the agent", Watch again).
import { Link, useNavigate, useParams } from 'react-router';
import { StageList } from '../components/GuideStages';
import { LoadError } from '../components/LoadError';
import {
  checkNote,
  endBody,
  endLine,
  isMemoryBusy,
  makingTitle,
  MEMORY_COPY,
  memoryFacts,
  memoryStageRows,
  memoryTitle,
  progressLabel,
} from '../core/memory-lane/memories';
import { buttonClassName } from '../design/Button';
import { Icon } from '../design/Icon';
import { Skeleton } from '../design/Skeleton';
import { MEMORY_LANE_PATH, useMemory } from '../hooks/useMemories';
import { useMemorySession } from '../hooks/useMemorySession';
import type { MemoryDetail, MemoryPerson } from '../services/api/types';
import './MemoryLanePage.css';

function Making({ detail }: { detail: MemoryDetail }) {
  const { summary, moments } = detail;
  const note = checkNote(summary);
  return (
    <section className="memory-lane__making" aria-live="polite">
      <div className="memory-lane__making-steps">
        <h1 className="memory-lane__title">{makingTitle(summary)}</h1>
        <p className="memory-lane__muted">{MEMORY_COPY.makingBody}</p>
        <StageList rows={memoryStageRows(summary)} />
        {note !== null && (
          <p className="memory-lane__note">
            <b>Agent check:</b> {note}
          </p>
        )}
      </div>
      {moments.length > 0 && (
        <div className="memory-lane__found">
          <span className="memory-lane__muted">{`${String(moments.length)} moments found`}</span>
          <ul className="memory-lane__found-grid">
            {moments.map((moment) => (
              <li key={moment.index}>{moment.thumb_url === null ? <Icon name="film" size="md" /> : <img src={moment.thumb_url} alt="" />}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function People({ people }: { people: readonly MemoryPerson[] }) {
  return (
    <ul className="memory-lane__people" aria-label="In this moment">
      {people.map((person) => (
        <li key={person.person_id}>
          {person.crop_url === null ? <Icon name="person" size="sm" /> : <img src={person.crop_url} alt="" />}
          {person.name}
        </li>
      ))}
    </ul>
  );
}

function uniquePeople(detail: MemoryDetail): MemoryPerson[] {
  const seen = new Map<string, MemoryPerson>();
  for (const moment of detail.moments) for (const person of moment.people) if (!seen.has(person.person_id)) seen.set(person.person_id, person);
  return [...seen.values()];
}

function End({ detail, onAgain }: { detail: MemoryDetail; onAgain: () => void }) {
  const { summary } = detail;
  const cover = summary.cover_url ?? detail.moments[0]?.thumb_url ?? null;
  return (
    <section className="memory-lane__end">
      <div className="memory-lane__cover">{cover === null ? <Icon name="face" size="lg" /> : <img src={cover} alt="" />}</div>
      <div className="memory-lane__end-text">
        <span className="memory-lane__badge">
          <Icon name="check" size="xs" />
          {MEMORY_COPY.checkedBadge}
        </span>
        <h1 className="memory-lane__title">{endLine(summary)}</h1>
        <p className="memory-lane__muted">{endBody(detail)}</p>
        {summary.fixed_count > 0 && <p className="memory-lane__muted">{checkNote(summary)}</p>}
        <People people={uniquePeople(detail)} />
        <div className="memory-lane__actions">
          <button type="button" className={buttonClassName('primary')} onClick={onAgain}>
            <Icon name="refresh" size="sm" />
            {MEMORY_COPY.watchAgain}
          </button>
          <Link className={buttonClassName('secondary')} to={MEMORY_LANE_PATH}>
            {MEMORY_COPY.allSessions}
          </Link>
        </div>
      </div>
    </section>
  );
}

function Player({ detail }: { detail: MemoryDetail }) {
  const navigate = useNavigate();
  const { state, moment, hasBegun, isReading, begin, act, bindVideo } = useMemorySession(detail.moments);
  if (moment === undefined) return <p className="memory-lane__muted">{MEMORY_COPY.noMoments}</p>;
  const count = detail.moments.length;
  const isPlaying = hasBegun && !state.isEnded;
  return (
    <>
      <section className="memory-lane__stage" hidden={state.isEnded} aria-label={memoryTitle(detail.summary)}>
        <video ref={bindVideo} className="memory-lane__video" poster={moment.thumb_url ?? undefined} playsInline preload="metadata" />
        <div className="memory-lane__dashes" aria-hidden="true">
          {detail.moments.map((each) => (
            <span key={each.index} data-on={each.index <= moment.index} />
          ))}
        </div>
        <div className="memory-lane__top">
          <button
            type="button"
            className="memory-lane__pill"
            onClick={() => {
              void navigate(MEMORY_LANE_PATH);
            }}
          >
            <Icon name="close" size="xs" />
            {MEMORY_COPY.end}
          </button>
          <span className="memory-lane__pill" aria-live="polite">
            {progressLabel(moment, state.at, count)}
          </span>
        </div>
        {isPlaying && moment.people.length > 0 && (
          <div className="memory-lane__who">
            {state.isRevealed ? (
              <People people={moment.people} />
            ) : (
              <button
                type="button"
                className="memory-lane__pill"
                onClick={() => {
                  act({ type: 'reveal' });
                }}
              >
                {MEMORY_COPY.whoIsThis}
              </button>
            )}
          </div>
        )}
        <div className="memory-lane__caption">
          {hasBegun ? (
            <>
              <p className="memory-lane__line">{moment.line}</p>
              <p className="memory-lane__prompt">{moment.prompt}</p>
              <div className="memory-lane__controls">
                <button
                  type="button"
                  className={buttonClassName('secondary')}
                  onClick={() => {
                    act({ type: 'again' });
                  }}
                >
                  <Icon name="refresh" size="sm" />
                  {MEMORY_COPY.again}
                </button>
                <span className="memory-lane__reading" data-on={isReading}>
                  <Icon name="speaker" size="sm" />
                  <span className="memory-lane__reading-text">{isReading ? MEMORY_COPY.readingAloud : ''}</span>
                </span>
                <button
                  type="button"
                  className={buttonClassName('primary')}
                  onClick={() => {
                    act({ type: 'next' });
                  }}
                >
                  {state.at + 1 >= count ? MEMORY_COPY.finish : MEMORY_COPY.next}
                  <Icon name="forward" size="sm" />
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="memory-lane__line">{memoryTitle(detail.summary)}</p>
              <p className="memory-lane__prompt">{memoryFacts(detail.summary)}</p>
              <div className="memory-lane__controls">
                <button type="button" className={buttonClassName('primary')} onClick={begin}>
                  <Icon name="play" size="sm" />
                  {MEMORY_COPY.start}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
      {state.isEnded && (
        <End
          detail={detail}
          onAgain={() => {
            act({ type: 'restart' });
          }}
        />
      )}
    </>
  );
}

function Body({ detail }: { detail: MemoryDetail }) {
  if (isMemoryBusy(detail.summary.status)) return <Making detail={detail} />;
  if (detail.summary.status === 'failed') {
    return (
      <section className="memory-lane__making" role="alert">
        <h1 className="memory-lane__title">{MEMORY_COPY.failedTitle}</h1>
        <p className="memory-lane__muted">{detail.summary.error ?? MEMORY_COPY.failedBody}</p>
        <Link className={buttonClassName('secondary')} to={MEMORY_LANE_PATH}>
          {MEMORY_COPY.allSessions}
        </Link>
      </section>
    );
  }
  return <Player detail={detail} />;
}

/**
 * The page.
 * @returns The session by its route id.
 */
export function MemoryLaneSessionPage() {
  const { id = '' } = useParams();
  const { state, refresh } = useMemory(id);
  return (
    <div className="theme-night memory-lane memory-lane--session">
      {state.status === 'loading' && (
        <div aria-busy="true">
          <Skeleton kind="line" />
          <Skeleton kind="line" />
        </div>
      )}
      {state.status === 'error' && <LoadError error={state.error} thing="session" onRetry={refresh} />}
      {state.status === 'ready' && <Body detail={state.data} />}
    </div>
  );
}
