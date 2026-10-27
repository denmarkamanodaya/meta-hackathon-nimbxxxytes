// A short's status in words and icons (S6, A3) and its editor score with a 5-part bar: "Ready",
// "Paused at draft 1 · Resume", "Editor score 44/50". Used by the Studio grid on both apps and the
// Mac inspector.
import { SCORE_MAX, SCORE_PARTS, scoreParts, stoppedShort } from '../core/agent-trail';
import { editorScoreLabel, pausedAtDraft, STUDIO_COPY } from '../core/copy';
import { Chip } from '../design/Chip';
import { Icon } from '../design/Icon';
import type { ShortListItem } from '../services/api/types';
import './ShortBadges.css';

/**
 * Ready with the frame, or paused at its last draft with Resume; nothing while working.
 * @param props - The short.
 * @returns The row, or null.
 */
export function ShortStatusBadges({ short }: { short: ShortListItem }) {
  if (short.status === 'ready') {
    return (
      <span className="short-badges">
        <Chip tone="success">
          <Icon name="check" size="xs" />
          {STUDIO_COPY.ready}
        </Chip>
        <span className="short-badges__muted">{short.aspect}</span>
      </span>
    );
  }
  if (short.status !== 'failed') return null;
  const stopped = stoppedShort(short.version_count);
  if (!stopped.canResume) {
    return (
      <span className="short-badges">
        <Chip tone="warning">
          <Icon name="clock" size="xs" />
          {STUDIO_COPY.stoppedBeforeDraft}
        </Chip>
      </span>
    );
  }
  return (
    <span className="short-badges">
      <Chip tone="warning">
        <Icon name="clock" size="xs" />
        {pausedAtDraft(stopped.draft)}
      </Chip>
      <span className="short-badges__resume">{STUDIO_COPY.resume}</span>
    </span>
  );
}

/**
 * The 5-part score bar alone (the Mac inspector writes the numbers above it).
 * @param props - The score, and whether the bar fills its row.
 * @returns The bar, hidden from assistive tech.
 */
export function ScoreBar({ score, isWide = false }: { score: number; isWide?: boolean }) {
  const lit = scoreParts(score);
  return (
    <span className={isWide ? 'editor-score__bar editor-score__bar--wide' : 'editor-score__bar'} aria-hidden="true">
      {Array.from({ length: SCORE_PARTS }, (_, index) => (
        <span key={index} className={index < lit ? 'editor-score__part editor-score__part--on' : 'editor-score__part'} />
      ))}
    </span>
  );
}

/**
 * The editor score: a 5-part bar and "Editor score 44/50".
 * @param props - The best draft's score.
 * @returns The row.
 */
export function EditorScore({ score }: { score: number }) {
  return (
    <span className="editor-score">
      <ScoreBar score={score} />
      {editorScoreLabel(score, SCORE_MAX)}
    </span>
  );
}
