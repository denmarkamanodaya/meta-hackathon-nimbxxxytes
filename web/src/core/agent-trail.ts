// View rules for the editing agent: live step labels, status, the merged step log, which version
// is best, and which critique note each revision change answers.
import type {
  AgentStep,
  Critique,
  CritiqueDimension,
  CritiqueNote,
  RevisionChange,
  ShortStatus,
  ShortVersion,
} from '../services/api/types';

const v = (step: AgentStep) => (step.version === null ? '' : ` v${String(step.version)}`);

const TOOL_LABEL: Record<string, (step: AgentStep) => string> = {
  render_preview: (step) => `Rendering${v(step)}…`,
  critique_preview: (step) => `Watching${v(step)}…`,
  search_moments: () => 'Looking for more moments…',
  get_segment: () => 'Reading a scene…',
};

/**
 * Headline for one agent step; the step's `summary` is shown under it.
 * @param step - A step row.
 * @returns For example "Planning…", "Rendering v1…", "Watching v1…", "Revising…".
 */
export function agentStepLabel(step: AgentStep): string {
  switch (step.kind) {
    case 'plan':
      return 'Planning…';
    case 'tool_call':
      return (TOOL_LABEL[step.tool ?? ''] ?? (() => `Using ${step.tool ?? 'a tool'}…`))(step);
    case 'tool_result':
      return step.tool === 'fit_timeline' ? 'Kept shots inside their scenes' : 'Result';
    case 'critique':
      return `Critique${v(step)}`;
    case 'revise':
      return 'Revising…';
    case 'final':
      return 'Done';
  }
}

const STATUS_LABEL: Record<ShortStatus, string> = {
  planning: 'Planning the cut…',
  rendering: 'Rendering…',
  critiquing: 'Watching the preview…',
  revising: 'Revising…',
  ready: 'Ready',
  failed: 'Stopped',
};

/**
 * Label for the short's status.
 * @param status - Short status.
 * @returns A short phrase.
 */
export const shortStatusLabel = (status: ShortStatus): string => STATUS_LABEL[status];

/**
 * True while the agent or a render is still running.
 * @param status - Short status.
 * @returns Whether more data will arrive.
 */
export const isShortWorking = (status: ShortStatus): boolean =>
  status !== 'ready' && status !== 'failed';

/** The highest editor score a draft can get (five dimensions, ten points each). */
export const SCORE_MAX = 50;

/** Parts in the editor-score bar. */
export const SCORE_PARTS = 5;

/**
 * How many parts of the editor-score bar to light: the score's share of the maximum, rounded to
 * the nearest part.
 * @param score - The best draft's score.
 * @returns 0–`SCORE_PARTS`.
 */
export function scoreParts(score: number): number {
  return Math.max(0, Math.min(SCORE_PARTS, Math.round((score / SCORE_MAX) * SCORE_PARTS)));
}

/** What the Studio list says about a stopped short. */
export type StoppedShort = { canResume: true; draft: number } | { canResume: false };

/**
 * A stopped short with drafts can be picked up from its last draft in the editor; one that
 * stopped before any draft has nothing to resume.
 * @param versionCount - Drafts the editor made.
 * @returns Whether it can resume, and from which draft.
 */
export function stoppedShort(versionCount: number): StoppedShort {
  return versionCount > 0 ? { canResume: true, draft: versionCount } : { canResume: false };
}

/**
 * Merges the polled step log with live SSE steps: one row per `seq`, ascending.
 * @param polled - Steps from `GET /shorts/{id}`.
 * @param live - Steps received over SSE.
 * @returns The merged log.
 */
export function mergeSteps(polled: readonly AgentStep[], live: readonly AgentStep[]): AgentStep[] {
  const bySeq = new Map<number, AgentStep>();
  for (const step of [...polled, ...live]) bySeq.set(step.seq, step);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The version to show first: the server's `best_version`, else the highest score, else the latest.
 * @param versions - All versions.
 * @param bestVersion - `short.best_version`.
 * @returns The version number, or null with no versions.
 */
export function pickBestVersion(versions: readonly ShortVersion[], bestVersion: number | null): number | null {
  if (bestVersion !== null && versions.some((version) => version.n === bestVersion)) return bestVersion;
  let best: ShortVersion | undefined;
  for (const version of versions) {
    const score = version.score_total ?? -1;
    if (best === undefined || score > (best.score_total ?? -1) || (score === (best.score_total ?? -1) && version.n > best.n)) {
      best = version;
    }
  }
  return best?.n ?? null;
}

/** A revision change with the critique note it answers, when that note can be found. */
export interface LinkedChange {
  change: RevisionChange;
  note: CritiqueNote | null;
  /** Version whose preview the note's `at` refers to. */
  noteVersion: number;
}

/**
 * Pairs each change of `version` with the critique note it answers.
 * @param version - A v2+ version.
 * @param versions - All versions (to find the critiqued one).
 * @returns One entry per change; `note` is null when the index or critique is missing.
 */
export function linkChanges(version: ShortVersion, versions: readonly ShortVersion[]): LinkedChange[] {
  const revision = version.timeline.revision;
  if (revision === null) return [];
  const critiqued = versions.find((candidate) => candidate.n === revision.from_version);
  const notes = critiqued?.critique?.notes ?? [];
  return revision.changes.map((change) => ({
    change,
    note: change.note_index === null ? null : (notes[change.note_index] ?? null),
    noteVersion: revision.from_version,
  }));
}

/**
 * True when a step's summary only repeats its label ("Watching v1…" / "Watching v1").
 * @param label - The headline from `agentStepLabel`.
 * @param summary - The step's summary.
 * @returns Whether the summary adds nothing.
 */
export function isRedundantSummary(label: string, summary: string): boolean {
  const norm = (text: string) => text.toLowerCase().replace(/[….!]/g, '').replace(/\s+/g, ' ').trim();
  return norm(summary) === '' || norm(summary) === norm(label);
}

/** Change of each score and the total against the previous version's critique. */
export interface ScoreDeltas {
  total: number;
  scores: Record<CritiqueDimension, number>;
}

/**
 * Score changes from `previous` to `current`.
 * @param current - This version's critique.
 * @param previous - The previous version's critique, or null for v1 / not critiqued yet.
 * @returns The deltas, or null without a previous critique.
 */
export function scoreDeltas(current: Critique, previous: Critique | null): ScoreDeltas | null {
  if (previous === null) return null;
  const diff = (dimension: CritiqueDimension) => current.scores[dimension] - previous.scores[dimension];
  return {
    total: current.total - previous.total,
    scores: {
      hook: diff('hook'),
      pacing: diff('pacing'),
      continuity: diff('continuity'),
      captions: diff('captions'),
      length: diff('length'),
    },
  };
}

/**
 * Signed delta text.
 * @param delta - Change in points.
 * @returns `"+7"`, `"−2"` (minus sign), or `""` for no change.
 */
export function formatDelta(delta: number): string {
  if (delta === 0) return '';
  const rounded = Math.round(delta * 10) / 10;
  return rounded > 0 ? `+${String(rounded)}` : `−${String(Math.abs(rounded))}`;
}

/**
 * Whether a step belongs in the visible log. Tool results are folded under their call, except
 * timeline fits: they record each in/out clamp, which the demo shows ("clamps are visible").
 * @param step - A step row.
 * @returns True to list it.
 */
export const isListedStep = (step: AgentStep): boolean =>
  step.kind !== 'tool_result' || step.tool === 'fit_timeline';

const DIMENSION_LABEL: Record<CritiqueDimension, string> = {
  hook: 'Hook',
  pacing: 'Pacing',
  continuity: 'Flow',
  captions: 'Captions',
  length: 'Length',
};

/** One score bar: this draft's score and, on a revision, the score it replaced. */
export interface ScoreRow {
  dimension: CritiqueDimension;
  label: string;
  score: number;
  previous: number | null;
}

/**
 * Score bars for a draft, with the previous draft's score per dimension when there is one.
 * @param critique - This draft's critique.
 * @param previous - The critique of the draft it revised, or null.
 * @returns Five rows in the design's order (hook, pacing, flow, captions, length).
 */
export function scoreRows(critique: Critique, previous: Critique | null): ScoreRow[] {
  return (['hook', 'pacing', 'continuity', 'captions', 'length'] as const).map((dimension) => ({
    dimension,
    label: DIMENSION_LABEL[dimension],
    score: critique.scores[dimension],
    previous: previous === null ? null : previous.scores[dimension],
  }));
}

/** What the Make-a-short screen explains for the shown draft. */
export interface DraftStory {
  /** The draft whose critique the notes come from: the one this draft revised, else itself. */
  watched: ShortVersion | null;
  /** The first draft, for "Draft 1 → Draft N"; null when the shown draft is the first. */
  first: ShortVersion | null;
}

/**
 * Picks the drafts the screen talks about.
 * @param shown - The draft on screen.
 * @param versions - All drafts.
 * @returns The watched draft and the first draft.
 */
export function draftStory(shown: ShortVersion, versions: readonly ShortVersion[]): DraftStory {
  const from = shown.timeline.revision?.from_version;
  const revised = from === undefined ? undefined : versions.find((v) => v.n === from);
  const first = versions.reduce<ShortVersion | null>((min, v) => (min === null || v.n < min.n ? v : min), null);
  return {
    watched: revised ?? (shown.critique === null ? null : shown),
    first: first !== null && first.n !== shown.n ? first : null,
  };
}

/**
 * A short's display name: the post caption of the shown draft, else "Your short".
 * @param shown - The draft on screen, or undefined.
 * @returns The name.
 */
export const shortName = (shown: ShortVersion | undefined): string => {
  const caption = shown?.timeline.post.caption.trim() ?? '';
  return caption === '' ? 'Your short' : caption;
};
