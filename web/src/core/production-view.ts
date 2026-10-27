// Pure rules for showing a production: the coverage line, the format chip, act labels, shots
// grouped by act and the words for each step of a plan run.
import { ACT_COPY, FORMAT_COPY, PRODUCTION_STATUS_COPY } from './copy';
import { formatDuration, formatLongDate } from './format';
import {
  ACTS,
  type Act,
  type ProductionFormat,
  type ProductionShot,
  type ProductionStatus,
  type ProductionSummary,
  type ShotMatch,
  type StudioStepEvent,
} from '../services/api/types';

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

/**
 * The header line under a production's title: "Story · 60 s · 4:5 · Shooting".
 * @param production - The production.
 * @returns The line.
 */
export const productionMeta = (production: Pick<ProductionSummary, 'format' | 'target_s' | 'aspect' | 'status'>): string =>
  [formatChip(production.format, production.target_s), production.aspect, PRODUCTION_STATUS_COPY[production.status]].join(' · ');

/**
 * Where a shot's matched moment is: "60th birthday · 2:29–2:36 · 4 takes" (takes only when more
 * than one).
 * @param match - The moment.
 * @param takeCount - Usable takes in the library.
 * @returns The line.
 */
export const matchLine = (match: Pick<ShotMatch, 'clip_title' | 'start_s' | 'end_s'>, takeCount: number): string =>
  [match.clip_title, timeRange(match.start_s, match.end_s), ...(takeCount > 1 ? [`${String(takeCount)} takes`] : [])].join(' · ');

/**
 * A shot's length in the cut: "11 s".
 * @param seconds - Its planned length.
 * @returns The length, whole seconds.
 */
export const shotLength = (seconds: number): string => `${String(Math.round(seconds))} s`;

/**
 * The selected shot's head line: "Shot 5 · payoff · 11 s".
 * @param shot - The shot.
 * @returns The line.
 */
export const shotHead = (shot: Pick<ProductionShot, 'ord' | 'act' | 'duration_s'>): string =>
  `Shot ${String(shot.ord)} · ${shot.act} · ${shotLength(shot.duration_s)}`;

/**
 * What a missing shot's row says to film: its first tip, else its direction.
 * @param shot - The shot.
 * @returns The hint.
 */
export const filmItHint = (shot: Pick<ProductionShot, 'tips' | 'direction'>): string => shot.tips[0] ?? shot.direction;

/**
 * Whether the production's story short exists: a cut, ready or published production has one (the
 * server moves it back to shooting when its short is deleted).
 * @param status - The production's status.
 * @returns True when there is a short to open.
 */
export const hasStoryShort = (status: ProductionStatus): boolean =>
  status === 'cutting' || status === 'ready' || status === 'published';

/**
 * A Productions row's second line: "Created 28 Oct 2026 · short cut".
 * @param createdAt - ISO-8601 creation time.
 * @param status - The production's status (whether its short is cut).
 * @param timeZone - IANA zone; defaults to the device zone. Tests pin it.
 * @returns The line.
 */
export function createdLine(createdAt: string, status: ProductionStatus, timeZone?: string): string {
  const created = `Created ${formatLongDate(createdAt, timeZone)}`;
  return hasStoryShort(status) ? `${created} · short cut` : created;
}

/**
 * A Productions row's chip for what is left to film: "To film: Raise the toast", "+N" when more.
 * @param missingTitles - Titles of the shots still to film, in play order.
 * @returns The chip text, or null when nothing is missing.
 */
export function toFilmChip(missingTitles: readonly string[]): string | null {
  const [first] = missingTitles;
  if (first === undefined) return null;
  const more = missingTitles.length - 1;
  return more > 0 ? `To film: ${first} +${String(more)}` : `To film: ${first}`;
}
