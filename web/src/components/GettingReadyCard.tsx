// The Library's "getting ready" card (P1): how many clips nimbytes is still working on, and for
// each its thumbnail, title, the 3-part step bar and "Understanding · step 2 of 3".
import { PROCESSING_STEPS } from '../core/copy';
import { processingLine, processingView } from '../core/processing-step';
import { StepBar } from '../design/StepBar';
import { useClipEvents } from '../hooks/useClips';
import type { ClipSummary } from '../services/api/types';
import './GettingReadyCard.css';

function Row({ clip, isLive }: { clip: ClipSummary; isLive: boolean }) {
  const view = processingView(clip.status, useClipEvents(clip.clip_id, isLive));
  return (
    <li className="getting-ready__row">
      <span className="getting-ready__thumb">{clip.thumb_url !== null && <img src={clip.thumb_url} alt="" />}</span>
      <span className="getting-ready__text">
        <span className="getting-ready__title">{clip.title}</span>
        {view.kind === 'step' && <StepBar steps={PROCESSING_STEPS.length} current={view.step} within={view.within} tone="surface" />}
        <span className="getting-ready__line">{processingLine(view)}</span>
      </span>
    </li>
  );
}

/** Props for `GettingReadyCard`. */
export interface GettingReadyCardProps {
  /** Clips still uploading or being understood, in library order. */
  clips: readonly ClipSummary[];
  /** Clips allowed a live SSE stream (the library caps how many). */
  live: ReadonlySet<string>;
}

/**
 * The card; nothing when no clip is getting ready.
 * @param props - See `GettingReadyCardProps`.
 * @returns The section, or null.
 */
export function GettingReadyCard({ clips, live }: GettingReadyCardProps) {
  if (clips.length === 0) return null;
  return (
    <section className="getting-ready" aria-labelledby="getting-ready-title">
      <h2 className="getting-ready__head" id="getting-ready-title">
        {`${String(clips.length)} ${clips.length === 1 ? 'clip' : 'clips'} getting ready`}
      </h2>
      <ul className="getting-ready__list">
        {clips.map((clip) => (
          <Row key={clip.clip_id} clip={clip} isLive={live.has(clip.clip_id)} />
        ))}
      </ul>
    </section>
  );
}
