// The critique trail as a stepper: v1 → v2 → v3, each with its score, the best one marked.
import type { ShortVersion } from '../services/api/types';
import './VersionStepper.css';

/** Props for `VersionStepper`. */
export interface VersionStepperProps {
  versions: readonly ShortVersion[];
  selected: number;
  best: number | null;
  onSelect: (n: number) => void;
}

/**
 * Tabs, one per version, joined by arrows.
 * @param props - See `VersionStepperProps`.
 * @returns The tab list.
 */
export function VersionStepper({ versions, selected, best, onSelect }: VersionStepperProps) {
  return (
    <div className="version-stepper" role="tablist" aria-label="Versions">
      {versions.map((version, index) => (
        <div key={version.n} className="version-stepper__item">
          {index > 0 && (
            <span className="version-stepper__arrow" aria-hidden="true">
              →
            </span>
          )}
          <button
            type="button"
            role="tab"
            aria-selected={version.n === selected}
            className={`version-stepper__tab${version.n === selected ? ' version-stepper__tab--on' : ''}`}
            onClick={() => {
              onSelect(version.n);
            }}
          >
            <span className="version-stepper__name">{`v${String(version.n)}`}</span>
            <span className="version-stepper__score">
              {version.score_total === null ? '—' : `${String(version.score_total)}/50`}
            </span>
            {version.n === best && <span className="version-stepper__best">Best</span>}
          </button>
        </div>
      ))}
    </div>
  );
}
