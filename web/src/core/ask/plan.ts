// What the Ask box shows for a request Muse Spark has read: the intent tag in the box, the plan
// card's kind badge, its steps (label, what it does, the model or tool doing it) and its setting
// chips. Copy from the approved Ask box mocks.
import type { IntentAnswer, IntentKind } from '../../services/api/types';
import { clipCount } from '../gallery';
import { stageRows } from '../guides';

/** One row of the plan card. */
export interface PlanRow {
  label: string;
  detail: string;
  /** The model or tool doing it; "" when none. */
  tool: string;
}

/** One setting chip under the steps ("Length 30 s"). */
export interface PlanSetting {
  label: string;
  value: string;
}

/** What the plan rows need to know beyond the intent. */
export interface PlanContext {
  /** The name of one of the caller's projects, or null when unknown. */
  projectName: (projectId: string) => string | null;
  /** How many clips the project holds, or null when unknown. */
  projectClipCount: (projectId: string) => number | null;
}

const TAG: Record<IntentKind, string> = {
  search: 'Search',
  upload: 'Upload',
  make_short: 'Short',
  make_guide: 'Guide',
  add_to_project: 'Project',
  unclear: 'Not sure yet',
};

const BADGE: Record<IntentKind, string> = { ...TAG, unclear: 'Ask' };

/**
 * The tag in the box once a request is read ("Short", "Not sure yet").
 * @param kind - The intent kind.
 * @returns The tag.
 */
export const intentTag = (kind: IntentKind): string => TAG[kind];

/**
 * The card's kind badge ("Short", "Guide", "Ask" for a question back).
 * @param kind - The intent kind.
 * @returns The badge.
 */
export const cardBadge = (kind: IntentKind): string => BADGE[kind];

/** The words under the card's title while it waits for Run. */
export const PLAN_LINE = 'Here is the plan. Nothing runs until you press Run.';
/** Who planned it. */
export const PLANNED_BY = 'Planned by Muse Spark';
/** The note beside a short's Run. */
export const SHORT_NOTE = 'About a minute · uses your Meta credits';
/** The note beside Make guide. */
export const GUIDE_NOTE = 'About a minute';
/** The line while a job runs. */
export const RUN_LINE = 'You can keep browsing; this card stays until it is done.';
/** The note beside Stop. */
export const STOP_NOTE = 'Stop keeps nothing';

/** The project a request names, as the plan words it ("Thai Trip"); "your project" when unknown. */
const projectOf = (intent: IntentAnswer, ctx: PlanContext): string =>
  intent.project_id === null ? (intent.new_project_name ?? 'your project') : (ctx.projectName(intent.project_id) ?? 'your project');

/** Where a short's moments come from, in one line. */
function shortSource(intent: IntentAnswer, ctx: PlanContext): string {
  switch (intent.source) {
    case 'attached':
      return `From ${clipCount(intent.clip_ids.length)} you added`;
    case 'project': {
      const count = intent.project_id === null ? null : ctx.projectClipCount(intent.project_id);
      return count === null ? projectOf(intent, ctx) : `${projectOf(intent, ctx)} · ${clipCount(count)}`;
    }
    case 'search':
      return `Search “${intent.query ?? ''}”`;
    case null:
      return 'Your library';
  }
}

const target = (intent: IntentAnswer): string => `${String(intent.target_s ?? 30)} s`;
const aspect = (intent: IntentAnswer): string => intent.aspect ?? '4:5';

/** The guide stages the card lists (Ready is the end, not a step), with their models. */
const GUIDE_ROWS: readonly { label: string; detail: string }[] = [
  { label: 'Find the steps', detail: 'Numbered steps from the video and what you said' },
  { label: 'Frame each step', detail: 'A still at the key second' },
  { label: 'Circle the controls', detail: 'The dial, the start button…' },
  { label: 'Voice each step', detail: 'Spoken, plays in silent mode' },
];

/**
 * The plan's steps for a request.
 * @param intent - The intent.
 * @param ctx - Project names and sizes.
 * @returns The rows; none for a search or a question back.
 */
export function planRows(intent: IntentAnswer, ctx: PlanContext): PlanRow[] {
  switch (intent.kind) {
    case 'make_short':
      return [
        { label: 'Find the moments', detail: shortSource(intent, ctx), tool: intent.source === 'search' ? 'Search + Muse Spark' : 'Muse Spark' },
        { label: 'Plan the cut', detail: 'Order, length and the hook', tool: 'Muse Spark' },
        { label: 'Cut, caption, blur hidden faces', detail: `${aspect(intent)}, about ${target(intent)}`, tool: 'Renderer + SAM 3.1' },
        { label: 'Review and fix', detail: 'The editor critiques its own draft once', tool: 'Muse Spark' },
      ];
    case 'make_guide': {
      const models = stageRows('queued', null).map((row) => row.model);
      return GUIDE_ROWS.map((row, index) => ({ ...row, tool: models[index] ?? '' }));
    }
    case 'upload':
      return [
        { label: 'Choose files', detail: 'Clips or a folder on this Mac', tool: '' },
        { label: 'Upload the files', detail: 'Progress shows on the Gallery tiles', tool: '' },
      ];
    case 'add_to_project': {
      const add = { label: `Add ${clipCount(intent.clip_ids.length)}`, detail: `To ${projectOf(intent, ctx)}`, tool: '' };
      return intent.project_id === null ? [{ label: 'Make the project', detail: `“${projectOf(intent, ctx)}”`, tool: '' }, add] : [add];
    }
    case 'search':
    case 'unclear':
      return [];
  }
}

/**
 * The setting chips under a plan.
 * @param intent - The intent.
 * @param ctx - Project names and sizes.
 * @returns The chips; none for kinds without settings.
 */
export function planSettings(intent: IntentAnswer, ctx: PlanContext): PlanSetting[] {
  if (intent.kind === 'make_short') {
    return [
      { label: 'Length', value: target(intent) },
      { label: 'Shape', value: aspect(intent) },
      { label: 'From', value: intent.source === 'attached' ? clipCount(intent.clip_ids.length) : shortSource(intent, ctx) },
    ];
  }
  if (intent.kind === 'make_guide') return [{ label: 'Voice', value: 'English (MMS-TTS)' }, { label: 'Steps', value: '3–12' }];
  return [];
}

/**
 * The line under an unclear card's title.
 * @param text - What was asked.
 * @returns “…” could be a few things.
 */
export const unclearLine = (text: string): string => `“${text.trim()}” could be a few things.`;

/**
 * Whether a "Did you mean…" choice asks for clips first: its text is the request itself ("Add the
 * task video with +"), so picking it opens + and the request goes again with the clips added.
 * @param choiceText - The choice's text.
 * @param requestText - What was asked.
 * @returns True for an add-clips choice.
 */
export const isAddClipsChoice = (choiceText: string, requestText: string): boolean => choiceText.trim() === requestText.trim();
