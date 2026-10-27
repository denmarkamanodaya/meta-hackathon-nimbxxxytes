// Pure rules for showing a production: the coverage line, the format chip, act labels, shots
// grouped by act and the words for each step of a plan run.
import { ACT_COPY, FORMAT_COPY } from './copy';
import { formatDuration } from './format';
import { ACTS, type Act, type ProductionFormat, type ProductionStatus, type StudioStepEvent } from '../services/api/types';

/** Target length a new production asks for, seconds (inside each format's accepted range). */
export const DEFAULT_TARGET_S: Record<ProductionFormat, number> = { story: 60, short: 20 };

/** Briefs the New production screen offers to start from. */
export const BRIEF_PRESETS: readonly { label: string; brief: string }[] = [
  {
    label: 'Day in my life',
    brief: 'A day in my life: wake up, coffee, the walk to work, one real moment with a friend, and the evening wind-down.',
  },
  {
    label: 'Tutorial',
    brief: 'A quick tutorial: show the result first, then the three steps up close, then the finished thing in use.',
  },
  {
    label: 'Travel recap',
    brief: 'A travel recap: arriving, the best food, the view everyone came for, and a last look before leaving.',
  },
];

/**
 * "7 of 9 shots covered · 2 to film".
 * @param covered - Shots with a matched moment.
 * @param total - Shots in the plan.
 * @returns The line; "Planning the shots" before the plan has any.
 */
export function coverageLine(covered: number, total: number): string {
  if (total === 0) return 'Planning the shots';
  const head = `${String(covered)} of ${String(total)} shots covered`;
  const missing = total - covered;
  return missing > 0 ? `${head} · ${String(missing)} to film` : head;
}

/**
 * Covered share as a whole percentage, 0–100.
 * @param covered - Covered shots.
 * @param total - Shots in the plan.
 * @returns The percentage; 0 for an empty plan.
 */
export const coveragePercent = (covered: number, total: number): number =>
  total <= 0 ? 0 : Math.round((Math.min(covered, total) / total) * 100);

/**
 * "Story · 60 s".
 * @param format - The production's format.
 * @param targetS - Its target length, seconds.
 * @returns The chip text.
 */
export const formatChip = (format: ProductionFormat, targetS: number): string =>
  `${FORMAT_COPY[format].name} · ${String(Math.round(targetS))} s`;

/** Chip tone per status: working is accent, waiting on the owner is warning. */
export const STATUS_TONE: Record<ProductionStatus, 'accent' | 'warning' | 'success' | 'danger'> = {
  planning: 'accent',
  shooting: 'warning',
  cutting: 'accent',
  ready: 'success',
  published: 'success',
  failed: 'danger',
};

/**
 * "ACT 1 · HOOK": the act's place in the story and its name, in capitals.
 * @param act - The act.
 * @returns The label.
 */
export const actLabel = (act: Act): string => `ACT ${String(ACTS.indexOf(act) + 1)} · ${ACT_COPY[act].toUpperCase()}`;

/** Shots of one act, in play order. */
export interface ActGroup<T> {
  act: Act;
  shots: T[];
}

/**
 * Groups shots by act in story order, each act's shots by `ord`; acts with no shots are left out.
 * @param shots - The shot list, any order.
 * @returns The groups.
 */
export function groupByAct<T extends { act: Act; ord: number }>(shots: readonly T[]): ActGroup<T>[] {
  return ACTS.map((act) => ({ act, shots: shots.filter((s) => s.act === act).sort((a, b) => a.ord - b.ord) })).filter(
    (group) => group.shots.length > 0,
  );
}

/** What a plan run is doing, for the live progress card. */
export interface PlanProgress {
  label: string;
  /** 0–1 when the step has a count (storyboards), else null. */
  fraction: number | null;
}

const BOARDS = /^boards (\d+)\/(\d+)$/;

/**
 * Words for one step event of a production's run.
 * @param event - The latest event.
 * @returns The label and, for storyboards, how far they got.
 */
export function planProgress(event: StudioStepEvent): PlanProgress {
  if (event.status === 'failed') return { label: 'Planning stopped', fraction: null };
  const boards = BOARDS.exec(event.step);
  if (boards !== null) {
    const done = Number(boards[1]);
    const total = Number(boards[2]);
    return { label: `Drawing storyboards ${String(done)} of ${String(total)}`, fraction: total > 0 ? done / total : null };
  }
  switch (event.step) {
    case 'planning':
      return { label: 'Starting the plan', fraction: null };
    case 'shot_list':
      return { label: 'Writing the shot list', fraction: null };
    case 'coverage':
      return { label: 'Checking your library for each shot', fraction: null };
    case 'done':
      return { label: 'Plan ready', fraction: 1 };
    default:
      return { label: 'Working', fraction: null };
  }
}

/**
 * A time range, "0:12–0:16".
 * @param startS - Start, seconds.
 * @param endS - End, seconds.
 * @returns The range.
 */
export const timeRange = (startS: number, endS: number): string => `${formatDuration(startS)}–${formatDuration(endS)}`;
