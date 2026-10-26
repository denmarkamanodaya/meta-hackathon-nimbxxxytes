// ProgressBar primitive: a thin determinate bar with an accessible value.
import './ProgressBar.css';

/** Props for `ProgressBar`. */
export interface ProgressBarProps {
  /** Completion, 0–100. */
  percent: number;
  /** Accessible name, for example the file name. */
  label: string;
  /** Colour role; `danger` for a stopped upload, `success` once done. */
  tone?: 'accent' | 'success' | 'danger';
}

/**
 * Horizontal progress bar; the fill width is the only inline style (computed geometry).
 * @param props - See `ProgressBarProps`.
 * @returns The progressbar element.
 */
export function ProgressBar({ percent, label, tone = 'accent' }: ProgressBarProps) {
  return (
    <div
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className={`progress-bar__fill progress-bar__fill--${tone}`}
        style={{ width: `${String(percent)}%` }}
      />
    </div>
  );
}
