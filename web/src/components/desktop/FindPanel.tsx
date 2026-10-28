// The Mac clip page's right column while Find this is on (board V18, "Where it appears"): how to
// use it until something is found; then the object (its name, where it is in view here, how many
// other clips have it) and every hit with Play; at the foot, Make a short from these and Show all in
// the Gallery.
import { useNavigate } from 'react-router';
import { FIND_COPY } from '../../core/copy';
import { foundSummary, handoffFromHits, hitClipPath, hitLine, showAllPath } from '../../core/find-this';
import { formatDuration } from '../../core/format';
import type { FindHit, FindResponse } from '../../services/api/types';
import { ClipPanel, ClipPanelFooter } from './ClipPanel';
import './FindPanel.css';

/** Props for `FindPanel`. */
export interface FindPanelProps {
  clipId: string;
  /** What was found; null while picking or tracking. */
  found: FindResponse | null;
  /** Seeks this clip's player. */
  onSeek: (seconds: number) => void;
}

/**
 * The column.
 * @param props - See `FindPanelProps`.
 * @returns The column.
 */
export function FindPanel({ clipId, found, onSeek }: FindPanelProps) {
  const navigate = useNavigate();
  const now = new Date();
  const play = (hit: FindHit) => {
    if (hit.clip_id === clipId) onSeek(hit.start_s);
    else void navigate(hitClipPath(hit));
  };
  const lead = found?.hits[0];
  return (
    <ClipPanel>
      {found === null ? (
        <div className="find-panel__intro">
          <span className="mac-columns__label">{FIND_COPY.findThis}</span>
          <p className="find-panel__text">{FIND_COPY.intro}</p>
        </div>
      ) : (
        <>
          <div className="find-panel__head">
            <span className="find-panel__crop">{lead?.thumb_url != null && <img src={lead.thumb_url} alt="" />}</span>
            <span className="find-panel__what">
              <span className="find-panel__label">{found.label}</span>
              <span className="find-panel__summary">{foundSummary(found, clipId)}</span>
            </span>
          </div>
          <ul className="find-panel__hits">
            {found.hits.map((hit) => (
              <li key={`${hit.clip_id}:${hit.segment_id}`}>
                <button
                  type="button"
                  className="find-panel__hit"
                  aria-label={`Play ${hit.clip_title} at ${formatDuration(hit.start_s)}`}
                  onClick={() => {
                    play(hit);
                  }}
                >
                  <span className="find-panel__thumb">{hit.thumb_url !== null && <img src={hit.thumb_url} alt="" loading="lazy" />}</span>
                  <span className="find-panel__hit-text">
                    <span className="find-panel__hit-title">{hit.clip_title}</span>
                    <span className="find-panel__hit-line">{hitLine(hit, clipId, now)}</span>
                  </span>
                  <span className="find-panel__at">{formatDuration(hit.start_s)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ClipPanelFooter>
        <button
          type="button"
          className="mac-button mac-button--primary"
          disabled={found === null || found.hits.length === 0}
          onClick={() => {
            if (found !== null) void navigate('/editor', { state: handoffFromHits(found.hits) });
          }}
        >
          {FIND_COPY.makeShort}
        </button>
        <button
          type="button"
          className="mac-button"
          disabled={found === null}
          onClick={() => {
            if (found !== null) void navigate(showAllPath(found.label));
          }}
        >
          {FIND_COPY.showAll}
        </button>
      </ClipPanelFooter>
    </ClipPanel>
  );
}
