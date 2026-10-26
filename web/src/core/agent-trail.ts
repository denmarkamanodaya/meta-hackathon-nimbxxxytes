// View rules for the editing agent: live step labels, status, the merged step log, which version
// is best, and which critique note each revision change answers.
import type {
  AgentStep,
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
      return 'Result';
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
