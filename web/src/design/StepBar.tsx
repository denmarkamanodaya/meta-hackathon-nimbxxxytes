// StepBar primitive: a short bar in equal segments, one per step. Steps before the current one are
// lit, the current one is lit as far as it has got, later ones are a track. Decorative: the step's
// words sit next to it.
import './StepBar.css';

/** Props for `StepBar`. */
export interface StepBarProps {
  /** How many segments. */
  steps: number;
  /** The current step, 1-based. */
  current: number;
  /** How far into the current step, 0–1. */
  within: number;
  /** `media` on footage (light on a dark scrim); `surface` on a card (accent on the track). */
  tone: 'media' | 'surface';
}

/**
 * The bar.
 * @param props - See `StepBarProps`.
 * @returns The bar, hidden from assistive tech.
 */
export function StepBar({ steps, current, within, tone }: StepBarProps) {
  return (
    <span className={`step-bar step-bar--${tone}`} aria-hidden="true">
      {Array.from({ length: steps }, (_, index) => {
        const lit = index + 1 < current ? 1 : index + 1 === current ? Math.max(0, Math.min(1, within)) : 0;
        return (
          <span key={index} className="step-bar__seg">
            <span className="step-bar__fill" style={{ width: `${String(Math.round(lit * 100))}%` }} />
          </span>
        );
      })}
    </span>
  );
}
