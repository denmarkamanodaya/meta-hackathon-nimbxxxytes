// Near-copies and same moments on a clip (Phase 29, mocks V52–V53), shared by the Mac right column
// and the phone clip page; each passes its own button classes and owns the confirm.
// - The tile badge: "Near-copy" / "Duplicate" in the warm tone, "2 angles" in the accent.
// - "Looks like a copy": how alike, the original's thumb and title (it opens it), the trimmed
//   hint, the not-searched line, and Remove this copy / Keep both.
// - "2 angles of this moment": the clips filmed then, each opening, and how far apart.
// - On the original, "1 copy of this clip".
import { Link } from 'react-router';
import { anglesLine, anglesNote, anglesTitle, copiedByLine, copySentence, momentRows, SIMILAR_COPY, tileBadge } from '../core/similar';
import type { ClipLink, ClipSummary } from '../services/api/types';
import './ClipSimilar.css';

const clipPath = (clipId: string) => `/clips/${encodeURIComponent(clipId)}`;

/**
 * A tile's badge, or nothing; the tile places it.
 * @param props - The clip, and the tile's class that places the badge.
 * @returns The badge.
 */
export function SimilarBadge({ clip, className = '' }: { clip: Pick<ClipSummary, 'status' | 'near_copy_of' | 'angles'>; className?: string }) {
  const badge = tileBadge(clip);
  if (badge === null) return null;
  return <span className={`similar-badge similar-badge--${badge.tone} ${className}`.trim()}>{badge.label}</span>;
}

/** Props for `CopyBox`. */
export interface CopyBoxProps {
  clip: ClipSummary;
  /** The older clip this one copies (`originalOf`). */
  original: ClipLink;
  onRemove: () => void;
  onKeep: () => void;
  /** Keep both or a remove runs: both buttons wait. */
  isBusy: boolean;
  /** The platform's button class, and its primary one. */
  buttonClass: string;
  primaryClass: string;
}

/**
 * "Looks like a copy".
 * @param props - See `CopyBoxProps`.
 * @returns The box.
 */
export function CopyBox({ clip, original, onRemove, onKeep, isBusy, buttonClass, primaryClass }: CopyBoxProps) {
  const sentence = copySentence(clip.duration_s, original);
  return (
    <section className="similar-box similar-box--copy" aria-label={SIMILAR_COPY.copyTitle}>
      <h3 className="similar-box__title">{SIMILAR_COPY.copyTitle}</h3>
      <p className="similar-box__body">
        {sentence.before}
        <b>{sentence.title}</b>
        {sentence.after}
        {sentence.trimmed !== null && ` ${sentence.trimmed}`}
      </p>
      <Link className="similar-box__original" to={clipPath(original.clip_id)}>
        <span className="similar-box__original-thumb">{original.thumb_url !== null && <img src={original.thumb_url} alt="" />}</span>
        <span className="similar-box__original-name">{`${original.title} · ${SIMILAR_COPY.theOriginal}`}</span>
      </Link>
      {clip.status === 'near_copy' && <p className="similar-box__note">{SIMILAR_COPY.copyNote}</p>}
      <div className="similar-box__actions">
        <button type="button" className={primaryClass} disabled={isBusy} onClick={onRemove}>
          {SIMILAR_COPY.removeCopy}
        </button>
        <button type="button" className={buttonClass} disabled={isBusy} onClick={onKeep}>
          {SIMILAR_COPY.keepBoth}
        </button>
      </div>
    </section>
  );
}

/**
 * "2 angles of this moment".
 * @param props - The clip and its same-moment links (at least one).
 * @returns The box.
 */
export function AnglesBox({ clip, links }: { clip: ClipSummary; links: readonly ClipLink[] }) {
  const rows = momentRows(clip, links);
  const title = anglesTitle(rows.length);
  return (
    <section className="similar-box similar-box--angles" aria-label={title}>
      <h3 className="similar-box__title">{title}</h3>
      <p className="similar-box__body">{anglesLine(clip.recorded_at, links)}</p>
      <ul className="similar-box__angles">
        {rows.map((row) => {
          const inner = (
            <>
              <span className="similar-box__angle-thumb">{row.thumbUrl !== null && <img src={row.thumbUrl} alt="" />}</span>
              <span className="similar-box__angle-text">
                <span className="similar-box__angle-name">{row.title}</span>
                <span className="similar-box__angle-line">{row.line}</span>
              </span>
            </>
          );
          return (
            <li key={row.clipId}>
              {row.isCurrent ? (
                <span className="similar-box__angle similar-box__angle--on" aria-current="true">
                  {inner}
                </span>
              ) : (
                <Link className="similar-box__angle" to={clipPath(row.clipId)}>
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <p className="similar-box__note">{anglesNote(rows.length)}</p>
    </section>
  );
}

/**
 * "1 copy of this clip" on the original, or nothing.
 * @param props - The detail's links.
 * @returns The line.
 */
export function CopiedByLine({ links }: { links: readonly ClipLink[] }) {
  const line = copiedByLine(links);
  return line === null ? null : <p className="similar-copied-by">{line}</p>;
}
