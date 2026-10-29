// The "2 working" pill above the Ask box while two or more jobs run; it opens the list of jobs,
// and picking one shows its card.
import { cardBadge } from '../../core/ask/plan';
import { jobState, listJobs, pillLabel } from '../../core/ask/jobs';
import { useAsk } from '../../hooks/useAsk';
import './MacAskBox.css';
import './AskQueuePill.css';

/** Props for `AskQueuePill`. */
export interface AskQueuePillProps {
  isListOpen: boolean;
  onListOpen: (isOpen: boolean) => void;
}

/**
 * The pill and, when open, its list.
 * @param props - See `AskQueuePillProps`.
 * @returns The pill, or nothing while fewer than two jobs run.
 */
export function AskQueuePill({ isListOpen, onListOpen }: AskQueuePillProps) {
  const { jobs, open } = useAsk();
  const label = pillLabel(jobs);
  if (label === null) return null;
  return (
    <div className="ask-queue">
      {isListOpen && (
        <ul className="ask-queue__list" aria-label="Your requests">
          {listJobs(jobs).map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className="ask-queue__row"
                onClick={() => {
                  open(job.id);
                  onListOpen(false);
                }}
              >
                <span className="ask-queue__badge">{cardBadge(job.intent.kind)}</span>
                <span className="ask-queue__title">{job.intent.title}</span>
                <span className="ask-queue__state">{jobState(job)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className="ask-queue__pill"
        aria-expanded={isListOpen}
        onClick={() => {
          onListOpen(!isListOpen);
        }}
      >
        <span className="ask-queue__dot" aria-hidden="true" />
        {label}
      </button>
    </div>
  );
}
