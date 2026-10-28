// Find this and Cut out on the PWA clip page (boards V18, V22, compact): the two buttons and the
// cost under the player; while Find this is on, how to use it, then what was found and every hit
// (tap to play), Make a short from these and Show all in the Gallery; Cut out opens its sheet.
import { useNavigate } from 'react-router';
import { FIND_COPY } from '../core/copy';
import { foundSummary, handoffFromHits, hitClipPath, hitLine, showAllPath } from '../core/find-this';
import { formatDuration } from '../core/format';
import { buttonClassName } from '../design/Button';
import { Icon } from '../design/Icon';
import { Sheet } from '../design/Sheet';
import { purposeOf, type ObjectPick, type PickPurpose } from '../hooks/useObjectPick';
import type { FindHit } from '../services/api/types';
import { CutoutView, cutoutTitle } from './CutoutView';
import './ClipFindThis.css';

/** Props for `ClipFindThis`. */
export interface ClipFindThisProps {
  clipId: string;
  pick: ObjectPick;
  /** Pauses the player before picking. */
  onStart: () => void;
  onSeek: (seconds: number) => void;
}

/**
 * The block.
 * @param props - See `ClipFindThisProps`.
 * @returns The block.
 */
export function ClipFindThis({ clipId, pick, onStart, onSeek }: ClipFindThisProps) {
  const navigate = useNavigate();
  const purpose = purposeOf(pick.state);
  const found = pick.state.phase === 'found' ? pick.state.found : null;
  const press = (which: PickPurpose) => {
    if (purpose !== which) onStart();
    pick.toggle(which);
  };
  const play = (hit: FindHit) => {
    if (hit.clip_id === clipId) onSeek(hit.start_s);
    else void navigate(hitClipPath(hit));
  };
  const toggleClass = (which: PickPurpose) =>
    purpose === which ? 'clip-find__toggle clip-find__toggle--on' : 'clip-find__toggle';
  return (
    <section className="clip-find" aria-label={FIND_COPY.findThis}>
      <div className="clip-find__buttons">
        <button
          type="button"
          className={toggleClass('find')}
          aria-pressed={purpose === 'find'}
          onClick={() => {
            press('find');
          }}
        >
          <Icon name="target" size="xs" />
          {FIND_COPY.findThis}
        </button>
        <button
          type="button"
          className={toggleClass('cutout')}
          aria-pressed={purpose === 'cutout'}
          onClick={() => {
            press('cutout');
          }}
        >
          <Icon name="scissors" size="xs" />
          {FIND_COPY.cutOut}
        </button>
        <span className="clip-find__cost">{FIND_COPY.cost}</span>
      </div>
      {purpose === 'find' && found === null && <p className="clip-find__intro">{FIND_COPY.intro}</p>}
      {found !== null && (
        <div className="clip-find__found">
          <p className="clip-find__what">
            <b>{found.label}</b> · {foundSummary(found, clipId)}
          </p>
          <ul className="clip-find__hits">
            {found.hits.map((hit) => (
              <li key={`${hit.clip_id}:${hit.segment_id}`}>
                <button
                  type="button"
                  className="clip-find__hit"
                  onClick={() => {
                    play(hit);
                  }}
                >
                  <span className="clip-find__thumb">{hit.thumb_url !== null && <img src={hit.thumb_url} alt="" loading="lazy" />}</span>
                  <span className="clip-find__hit-text">
                    <span className="clip-find__hit-title">{hit.clip_title}</span>
                    <span className="clip-find__hit-line">{hitLine(hit, clipId, new Date())}</span>
                  </span>
                  <span className="clip-find__at">{formatDuration(hit.start_s)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="clip-find__actions">
            <button
              type="button"
              className={buttonClassName('primary')}
              disabled={found.hits.length === 0}
              onClick={() => {
                void navigate('/editor', { state: handoffFromHits(found.hits) });
              }}
            >
              {FIND_COPY.makeShort}
            </button>
            <button
              type="button"
              className={buttonClassName('secondary')}
              onClick={() => {
                void navigate(showAllPath(found.label));
              }}
            >
              {FIND_COPY.showAll}
            </button>
          </div>
        </div>
      )}
      <Sheet
        open={pick.state.phase === 'cut'}
        onClose={pick.cancel}
        title={pick.state.phase === 'cut' ? cutoutTitle(pick.state.cutout.label) : FIND_COPY.cutOut}
      >
        {pick.state.phase === 'cut' && (
          <CutoutView
            cutout={pick.state.cutout}
            atS={pick.state.point.t_s}
            buttonClass={buttonClassName('secondary')}
            primaryClass={buttonClassName('primary')}
          />
        )}
      </Sheet>
    </section>
  );
}
