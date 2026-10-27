// The acts strip on a story short: the cut as a bar of its shots sized by length and coloured by
// act, each shot listed with its act, time range and planned title ("Not in plan" when the editor
// added it), then the planned shots the cut lacks.
import { actsStrip, type StripClip } from '../core/acts-strip';
import { ACT_COPY, PRODUCTION_COPY } from '../core/copy';
import { timeRange } from '../core/production-view';
import { Chip } from '../design/Chip';
import type { ActShot } from '../services/api/types';
import './ActsStrip.css';

/** Props for `ActsStrip`. */
export interface ActsStripProps {
  /** The shown draft's clips, in cut order. */
  clips: readonly StripClip[];
  /** The production's planned shots. */
  shots: readonly ActShot[];
}

/**
 * The strip.
 * @param props - See `ActsStripProps`.
 * @returns The section.
 */
export function ActsStrip({ clips, shots }: ActsStripProps) {
  const strip = actsStrip(clips, shots);
  if (strip.parts.length === 0) return null;
  return (
    <section className="acts-strip" aria-label="Acts">
      <div className="acts-strip__bar" aria-hidden="true">
        {strip.parts.map((part, index) => (
          <span
            key={index}
            className={`acts-strip__part acts-strip__part--${part.act ?? 'none'}`}
            style={{ flexGrow: part.share }}
          />
        ))}
      </div>
      <ol className="acts-strip__list">
        {strip.parts.map((part, index) => (
          <li key={index} className="acts-strip__row">
            <span className={`acts-strip__dot acts-strip__part--${part.act ?? 'none'}`} aria-hidden="true" />
            <span className="acts-strip__act">{part.act === null ? PRODUCTION_COPY.notInPlan : ACT_COPY[part.act]}</span>
            <span className="acts-strip__time">{timeRange(part.start_s, part.end_s)}</span>
            {part.title !== null && <span className="acts-strip__title">{part.title}</span>}
          </li>
        ))}
      </ol>
      {strip.missing.length > 0 && (
        <div className="acts-strip__missing" aria-label="Planned shots not in this cut">
          <span className="acts-strip__missing-label">{PRODUCTION_COPY.missing}</span>
          {strip.missing.map((shot) => (
            <Chip key={shot.ord} tone="danger">
              {shot.title}
            </Chip>
          ))}
        </div>
      )}
    </section>
  );
}
