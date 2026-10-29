// The Ask box's jobs: each request Muse Spark read becomes a job that waits as a plan, runs, and
// ends done or failed. Pure state changes (newest first), which card shows above the box, the
// "2 working" pill and its list, and the running card's rows, bar and lines.
import type { IntentAnswer } from '../../services/api/types';
import { formatDuration } from '../format';
import { clipCount } from '../gallery';
import { planRows, type PlanContext, type PlanRow } from './plan';
import { scoreOutOfTen } from './progress';

/** Where a job is. */
export type AskJobStatus = 'plan' | 'running' | 'done' | 'failed';

/** One request and what it started. */
export interface AskJob {
  id: string;
  /** What was asked. */
  text: string;
  /** The clips added to the box when it was asked. */
  addedClipIds: string[];
  intent: IntentAnswer;
  status: AskJobStatus;
  /** How many of the card's rows are done. */
  rowsDone: number;
  /** When Run was pressed and when it ended, ms; null before. */
  startedAt: number | null;
  endedAt: number | null;
  shortId: string | null;
  guideId: string | null;
  projectId: string | null;
  /** Moments found for a short, or files picked for an upload. */
  found: number | null;
  /** A short's best editor score (out of `SCORE_MAX`). */
  score: number | null;
  error: string | null;
}

/** What can happen to the jobs. */
export type AskAction =
  | { type: 'planned'; id: string; text: string; addedClipIds: string[]; intent: IntentAnswer }
  | { type: 'started'; id: string; at: number }
  | { type: 'progressed'; id: string; patch: Partial<Pick<AskJob, 'rowsDone' | 'shortId' | 'guideId' | 'projectId' | 'found' | 'score'>> }
  | { type: 'finished'; id: string; at: number }
  | { type: 'failed'; id: string; at: number; error: string }
  | { type: 'removed'; id: string };

/** Most jobs kept; the oldest finished ones go first. */
export const ASK_JOBS_MAX = 8;

/**
 * Applies one action. A plan is kept newest first; a job that is not there is left alone.
 * @param jobs - The jobs, newest first.
 * @param action - What happened.
 * @returns The new jobs.
 */
export function askReducer(jobs: readonly AskJob[], action: AskAction): AskJob[] {
  switch (action.type) {
    case 'planned': {
      const job: AskJob = {
        id: action.id,
        text: action.text,
        addedClipIds: action.addedClipIds,
        intent: action.intent,
        status: 'plan',
        rowsDone: 0,
        startedAt: null,
        endedAt: null,
        shortId: null,
        guideId: null,
        projectId: null,
        found: null,
        score: null,
        error: null,
      };
      return trim([job, ...jobs]);
    }
    case 'removed':
      return jobs.filter((job) => job.id !== action.id);
    default:
      return jobs.map((job) => (job.id === action.id ? change(job, action) : job));
  }
}

function change(job: AskJob, action: Exclude<AskAction, { type: 'planned' | 'removed' }>): AskJob {
  switch (action.type) {
    case 'started':
      return job.status === 'plan' ? { ...job, status: 'running', startedAt: action.at } : job;
    case 'progressed':
      return job.status === 'running' ? { ...job, ...action.patch, rowsDone: Math.max(job.rowsDone, action.patch.rowsDone ?? 0) } : job;
    case 'finished':
      return job.status === 'running' ? { ...job, status: 'done', endedAt: action.at, rowsDone: rowCount(job) } : job;
    case 'failed':
      return job.status === 'running' ? { ...job, status: 'failed', endedAt: action.at, error: action.error } : job;
  }
}

/** Keeps at most `ASK_JOBS_MAX`, dropping the oldest finished jobs (never a plan or a running one). */
function trim(jobs: AskJob[]): AskJob[] {
  const kept = [...jobs];
  for (let at = kept.length - 1; at >= 0 && kept.length > ASK_JOBS_MAX; at -= 1) {
    const status = kept[at]?.status;
    if (status === 'done' || status === 'failed') kept.splice(at, 1);
  }
  return kept;
}

/** Rows on a job's card (the plan's rows; the kinds without rows have none). */
const rowCount = (job: AskJob): number => planRows(job.intent, NO_CONTEXT).length;

const NO_CONTEXT: PlanContext = { projectName: () => null, projectClipCount: () => null };

/** How many jobs are running. */
export const runningCount = (jobs: readonly AskJob[]): number => jobs.filter((job) => job.status === 'running').length;

/** The pill shows from this many running jobs. */
export const PILL_FROM = 2;

/**
 * The pill above the box ("2 working"), while two or more jobs run.
 * @param jobs - The jobs.
 * @returns The label, or null for no pill.
 */
export function pillLabel(jobs: readonly AskJob[]): string | null {
  const count = runningCount(jobs);
  return count >= PILL_FROM ? `${String(count)} working` : null;
}

/** Most rows the pill's list shows. */
export const ASK_LIST_MAX = 5;

/**
 * The pill's list: running jobs first, then the rest, newest first within each, at most
 * `ASK_LIST_MAX`.
 * @param jobs - The jobs, newest first.
 * @returns The rows.
 */
export function listJobs(jobs: readonly AskJob[]): AskJob[] {
  const running = jobs.filter((job) => job.status === 'running');
  const rest = jobs.filter((job) => job.status !== 'running');
  return [...running, ...rest].slice(0, ASK_LIST_MAX);
}

/**
 * The job whose card sits above the box: the one opened from the list, else the newest plan (a
 * question back is a plan too), else the newest running job, else the newest finished one.
 * @param jobs - The jobs, newest first.
 * @param openId - The job opened from the list, if any.
 * @returns The job, or null for no card.
 */
export function shownJob(jobs: readonly AskJob[], openId: string | null): AskJob | null {
  const opened = openId === null ? undefined : jobs.find((job) => job.id === openId);
  return (
    opened ??
    jobs.find((job) => job.status === 'plan') ??
    jobs.find((job) => job.status === 'running') ??
    jobs.find((job) => job.status === 'done' || job.status === 'failed') ??
    null
  );
}

/** A row's state on the card. */
export type RowState = 'done' | 'now' | 'next';

/** One row as the card draws it. */
export interface RowView extends PlanRow {
  state: RowState;
}

/** What a done row says once the real number is in. */
function doneDetail(job: AskJob, index: number, row: PlanRow): string {
  if (job.intent.kind === 'make_short' && index === 0 && job.found !== null) return `Found ${String(job.found)} moments, best first`;
  if (job.intent.kind === 'make_short' && index === 3 && job.score !== null) return `Score ${String(scoreOutOfTen(job.score))}/10`;
  if (job.intent.kind === 'upload' && index === 0 && job.found !== null) return `${String(job.found)} picked`;
  return row.detail;
}

/**
 * The card's rows with their state: before Run every row is next; while running the rows done are
 * ticked and the one after them runs; once done every row is ticked.
 * @param job - The job.
 * @param ctx - Project names and sizes.
 * @returns The rows.
 */
export function rowViews(job: AskJob, ctx: PlanContext): RowView[] {
  return planRows(job.intent, ctx).map((row, index) => {
    if (job.status === 'plan') return { ...row, state: 'next' };
    const isDone = job.status === 'done' || index < job.rowsDone;
    const isNow = job.status === 'running' && index === job.rowsDone;
    return { ...row, detail: isDone ? doneDetail(job, index, row) : row.detail, state: isDone ? 'done' : isNow ? 'now' : 'next' };
  });
}

/** The bar on a running or done card. */
export interface BarView {
  /** 0–100. */
  percent: number;
  label: string;
  right: string;
}

/**
 * The bar: half a row for the one running ("Step 2 of 4 · Plan the cut", "38%"); once done "All 4
 * steps done" and how long it took.
 * @param job - A running or finished job.
 * @param rows - Its rows.
 * @returns The bar.
 */
export function barView(job: AskJob, rows: readonly PlanRow[]): BarView {
  const count = rows.length;
  if (job.status === 'done') {
    const took = job.startedAt === null || job.endedAt === null ? 0 : (job.endedAt - job.startedAt) / 1000;
    return { percent: 100, label: `All ${String(count)} steps done`, right: formatDuration(took) };
  }
  const at = Math.min(job.rowsDone, Math.max(0, count - 1));
  const percent = count === 0 ? 0 : Math.round(((at + 0.5) / count) * 100);
  return { percent, label: `Step ${String(at + 1)} of ${String(count)} · ${rows[at]?.label ?? ''}`, right: `${String(percent)}%` };
}

/**
 * The line under a finished card's title.
 * @param job - A done job.
 * @param ctx - Project names.
 * @returns The line.
 */
export function doneLine(job: AskJob, ctx: PlanContext): string {
  const { intent } = job;
  switch (intent.kind) {
    case 'make_short': {
      const score = job.score === null ? '' : `, editor score ${String(scoreOutOfTen(job.score))}/10`;
      return `Your short is ready: ${intent.aspect ?? '4:5'}, about ${String(intent.target_s ?? 30)} s${score}.`;
    }
    case 'make_guide':
      return 'Your iGuide is ready.';
    case 'upload':
      return `${String(job.found ?? 0)} ${job.found === 1 ? 'file is' : 'files are'} uploading: progress shows on the Gallery tiles.`;
    case 'add_to_project': {
      const id = job.projectId ?? intent.project_id;
      const name = (id === null ? null : ctx.projectName(id)) ?? intent.new_project_name ?? 'the project';
      return `${clipCount(intent.clip_ids.length)} added to ${name}.`;
    }
    case 'search':
    case 'unclear':
      return '';
  }
}

/**
 * A row of the pill's list: where the job is in a few words.
 * @param job - The job.
 * @returns "Step 2 of 4", "Ready", "Stopped" or "Waiting for Run".
 */
export function jobState(job: AskJob): string {
  switch (job.status) {
    case 'plan':
      return 'Waiting for Run';
    case 'running':
      return `Step ${String(Math.min(job.rowsDone + 1, rowCount(job)))} of ${String(rowCount(job))}`;
    case 'done':
      return 'Ready';
    case 'failed':
      return 'Stopped';
  }
}
