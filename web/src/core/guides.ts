// MyWay guide rules the PWA and the Mac app share (phase 26, mocks V33–V37): the progress list
// while a guide is made, the list row's badge and line, step navigation and swipe, step edits,
// and the words for each. Pure: no IO, no clock.
import { titleProblem } from './copy';
import { formatDuration } from './format';
import type { GuideStage, GuideStatus, GuideStep, GuideStepEdit, GuideSummary } from '../services/api/types';
import { GUIDE_STAGES } from '../services/api/types';

/** User-facing words for guides. */
export const GUIDE_COPY = {
  section: 'Step-by-step help made from your videos',
  guides: 'iGuide',
  makeGuide: 'Make an iGuide',
  makeGuideMac: 'Make an iGuide…',
  starting: 'Starting…',
  emptyTitle: 'No iGuides yet',
  emptyBody: 'Open a clip of a task (a washing machine, a TV remote, a kettle) and tap Make an iGuide.',
  openGuide: 'Open iGuide',
  start: 'Start the iGuide',
  play: '▶ Play',
  stop: '■ Stop',
  replaying: '↻ Replaying this step',
  editText: 'Edit text',
  back: 'Back',
  nextStep: 'Next step',
  done: 'Done',
  modelsLine: 'Voice: Meta MMS-TTS · Steps: Muse Spark · Circle: SAM 3.1',
  refusedTitle: 'iGuides are for everyday tasks',
  refusedBody:
    'We don’t make iGuides for medicines, electrical work, gas or driving, because a wrong step could hurt someone.',
  refusedAsk: 'Please ask a doctor, pharmacist or qualified person for these.',
  chooseAnother: 'Choose another video',
  failedTitle: 'This iGuide could not be made',
  editTitle: 'Edit step',
  stepTitleLabel: 'Step title',
  instructionLabel: 'Instruction',
  save: 'Save',
  cancel: 'Cancel',
  rename: 'Rename',
  renameGuide: 'Rename iGuide…',
  renameTitle: 'Rename iGuide',
  titleField: 'Title',
  titleEmpty: 'Give the iGuide a title.',
} as const;

/** The longest guide title the API stores, in characters after trimming. */
export const MAX_GUIDE_TITLE_CHARS = 60;

/**
 * What is wrong with a new guide title, as the API counts it (trimmed, 1–60 characters), or null
 * when it may be saved.
 * @param title - The typed title.
 * @returns The problem, or null.
 */
export const guideTitleProblem = (title: string): string | null => titleProblem(title, MAX_GUIDE_TITLE_CHARS, GUIDE_COPY.titleEmpty);

/**
 * Whether ▶ Play has anything to play: the step's voice, its clip, or both.
 * @param step - The step's media URLs.
 * @returns False when both are missing (Play is off).
 */
export const canPlayStep = (step: Pick<GuideStep, 'audio_url' | 'clip_url'>): boolean =>
  step.audio_url !== null || step.clip_url !== null;

/** Statuses during which the guide is still being made (poll it). */
export const isGuideBusy = (status: GuideStatus): boolean => status === 'queued' || status === 'running';

/** A V33 progress row's state. */
export type StageState = 'done' | 'now' | 'next';

/** One V33 progress row. */
export interface StageRow {
  stage: GuideStage;
  label: string;
  /** The model or tool doing it ("" for Ready). */
  model: string;
  state: StageState;
}

const STAGE_TEXT: Record<GuideStage, { label: string; model: string; line: string }> = {
  steps: { label: 'Steps found', model: 'Muse Spark', line: 'finding the steps' },
  frames: { label: 'Step frames', model: 'ffmpeg', line: 'taking the step photos' },
  highlight: { label: 'Circling the controls', model: 'SAM 3.1', line: 'circling the controls' },
  voice: { label: 'Voice for each step', model: 'MMS-TTS', line: 'recording the voice' },
  ready: { label: 'Ready', model: '', line: 'nearly ready' },
};

/**
 * The progress list for a guide: stages before the running one are done.
 * @param status - The guide's status.
 * @param stage - The running stage (null while queued: nothing has started).
 * @returns One row per stage, in pipeline order.
 */
export function stageRows(status: GuideStatus, stage: GuideStage | null): StageRow[] {
  const at = status === 'ready' ? GUIDE_STAGES.length : stage === null ? -1 : GUIDE_STAGES.indexOf(stage);
  return GUIDE_STAGES.map((s, index) => ({
    stage: s,
    ...STAGE_TEXT[s],
    state: index < at ? 'done' : index === at ? 'now' : 'next',
  }));
}

/** A list row's badge and its colour role. */
export interface GuideBadge {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
}

/**
 * The V33 badge: Making while busy, then Not made, Failed or Ready.
 * @param guide - The list row.
 * @returns The badge.
 */
export function guideBadge(guide: Pick<GuideSummary, 'status'>): GuideBadge {
  if (isGuideBusy(guide.status)) return { label: 'Making', tone: 'neutral' };
  if (guide.status === 'refused') return { label: 'Not made', tone: 'warning' };
  if (guide.status === 'failed') return { label: 'Failed', tone: 'danger' };
  return { label: 'Ready', tone: 'success' };
}

const stepsWord = (count: number) => `${String(count)} ${count === 1 ? 'step' : 'steps'}`;

/**
 * The Mac Guides header's count line.
 * @param count - Guides in the list.
 * @returns "1 iGuide" or "3 iGuides".
 */
export const guideCount = (count: number): string => `${String(count)} ${count === 1 ? 'iGuide' : 'iGuides'}`;

/**
 * The V33 line under a row's title ("6 steps · 2:04 clip", "Making… circling the controls").
 * @param guide - The list row.
 * @returns The line.
 */
export function guideMetaLine(guide: GuideSummary): string {
  if (guide.status === 'queued') return 'Making… waiting to start';
  if (guide.status === 'running') return `Making… ${guide.stage === null ? 'starting' : STAGE_TEXT[guide.stage].line}`;
  if (guide.status === 'refused') return 'Not an everyday task';
  if (guide.status === 'failed') return guide.error ?? 'Could not be made';
  const parts = [stepsWord(guide.step_count)];
  if (guide.clip_duration_s !== null) parts.push(`${formatDuration(guide.clip_duration_s)} clip`);
  return parts.join(' · ');
}

/**
 * "From “Washing machine” · 2:04", or "From the clip" when the server sends no clip facts.
 * @param clipTitle - The source clip's title.
 * @param durationS - Its length, seconds.
 * @returns The line.
 */
export function fromClipLine(clipTitle: string | null, durationS: number | null): string {
  const from = clipTitle === null ? 'From the clip' : `From “${clipTitle}”`;
  return durationS === null ? from : `${from} · ${formatDuration(durationS)}`;
}

/** Where Back and Next go from one step. */
export interface StepNav {
  /** The step shown, clamped to 1…count. */
  n: number;
  /** "Step 3 of 6". */
  label: string;
  prev: number | null;
  /** Null on the last step (Next reads Done). */
  next: number | null;
}

/**
 * Clamps a step number and works out its neighbours.
 * @param n - The wanted step (1-based).
 * @param count - How many steps the guide has (≥ 1).
 * @returns The navigation.
 */
export function stepNav(n: number, count: number): StepNav {
  const last = Math.max(1, count);
  const at = Math.min(last, Math.max(1, Math.trunc(n)));
  return {
    n: at,
    label: `Step ${String(at)} of ${String(last)}`,
    prev: at > 1 ? at - 1 : null,
    next: at < last ? at + 1 : null,
  };
}

/**
 * Reads the `:n` route segment.
 * @param raw - The segment.
 * @returns A positive step number, or 1 when it is not one.
 */
export function readStepParam(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

/** Horizontal travel a swipe must pass to change step, px. */
export const STEP_SWIPE_PX = 60;

/**
 * Decides a horizontal swipe on the step view; a mostly vertical move is a scroll, not a swipe.
 * @param dx - Horizontal travel, px (negative = left).
 * @param dy - Vertical travel, px.
 * @returns `next` for a left swipe, `prev` for a right one, else null.
 */
export function swipeStep(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < STEP_SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 2) return null;
  return dx < 0 ? 'next' : 'prev';
}

/**
 * Only the fields that changed, trimmed, so the PATCH body carries exactly the edit.
 * @param before - The step's current text.
 * @param after - The text in the form.
 * @returns The edit, or null when nothing changed or a field is empty.
 */
export function stepEdit(
  before: { title: string; instruction: string },
  after: { title: string; instruction: string },
): GuideStepEdit | null {
  const title = after.title.trim();
  const instruction = after.instruction.trim();
  if (title === '' || instruction === '') return null;
  const edit: GuideStepEdit = {
    ...(title === before.title ? {} : { title }),
    ...(instruction === before.instruction ? {} : { instruction }),
  };
  return Object.keys(edit).length === 0 ? null : edit;
}
