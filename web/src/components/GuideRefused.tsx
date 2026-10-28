// The safety refusal (V37): a warning icon, "Guides are for everyday tasks", what the video looks
// like when Spark said so, why, who to ask, and "Choose another video" back to the Gallery.
import { Link } from 'react-router';
import { GUIDE_COPY } from '../core/guides';
import './GuideRefused.css';

/** Props for `GuideRefused`. */
export interface GuideRefusedProps {
  /** What the clip looks like ("taking medication"); null leaves that sentence out. */
  reason: string | null;
  /** Class of the "Choose another video" link (the PWA's big button, a Mac button). */
  linkClass: string;
}

function WarningIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

/**
 * The refusal.
 * @param props - See `GuideRefusedProps`.
 * @returns The section.
 */
export function GuideRefused({ reason, linkClass }: GuideRefusedProps) {
  return (
    <section className="guide-refused" aria-labelledby="guide-refused-title">
      <span className="guide-refused__icon">
        <WarningIcon />
      </span>
      <h1 id="guide-refused-title" className="guide-refused__title">
        {GUIDE_COPY.refusedTitle}
      </h1>
      <p className="guide-refused__body">
        {reason !== null && (
          <>
            This video looks like <b>{reason}</b>.{' '}
          </>
        )}
        {GUIDE_COPY.refusedBody}
      </p>
      <p className="guide-refused__ask">{GUIDE_COPY.refusedAsk}</p>
      <span className="guide-refused__grow" />
      <Link to="/" className={linkClass}>
        {GUIDE_COPY.chooseAnother}
      </Link>
    </section>
  );
}
