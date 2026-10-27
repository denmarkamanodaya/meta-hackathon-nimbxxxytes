// The three steps a clip shows while nimbytes works on it (Uploading → Understanding → Ready), from
// the clip's status and its latest pipeline event. The pipeline's own step names ("Making proxy…")
// stay on the clip page; tiles and the upload queue only show these three. A failed clip and a
// duplicate leave the steps and keep their own words.
import { PIPELINE_STEPS, type ClipEvent, type ClipStatus } from '../services/api/types';
import { PROCESSING_COPY, PROCESSING_STEPS, stepOfLine, type ProcessingStepLabel } from './copy';

/** What a tile or upload card shows for a clip. */
export type ProcessingView =
  | {
      kind: 'step';
      /** 1-based: 1 Uploading, 2 Understanding, 3 Ready. */
      step: 1 | 2 | 3;
      label: ProcessingStepLabel;
      /** How far into the current step, 0–1, for the partly lit segment (1 when ready). */
      within: number;
    }
  | { kind: 'failed'; label: string }
  | { kind: 'duplicate'; label: string };

/** Pipeline steps before `ready`: the work inside "Understanding". */
const WORK_STEPS = PIPELINE_STEPS.length - 1;

/** While uploading the tile has no byte count: draw the step half lit. */
const UPLOADING_WITHIN = 0.5;

const step = (n: 1 | 2 | 3, within: number): ProcessingView => ({
  kind: 'step',
  step: n,
  label: PROCESSING_STEPS[n - 1] ?? 'Ready',
  within,
});

/**
 * Maps a clip to its processing view.
 * @param status - The clip's status (polled).
 * @param event - The latest live pipeline event, or null before any arrives.
 * @returns The step with its label and progress, or the failed or duplicate words.
 */
export function processingView(status: ClipStatus, event: ClipEvent | null): ProcessingView {
  if (status === 'failed' || event?.status === 'failed') return { kind: 'failed', label: PROCESSING_COPY.failed };
  if (status === 'duplicate') return { kind: 'duplicate', label: PROCESSING_COPY.duplicate };
  if (status === 'ready' || event?.step === 'ready') return step(3, 1);
  if (status === 'uploading') return step(1, UPLOADING_WITHIN);
  if (event === null) return step(2, 0);
  const index = PIPELINE_STEPS.indexOf(event.step);
  return step(2, Math.min(1, (index + (event.status === 'done' ? 1 : 0.5)) / WORK_STEPS));
}

/**
 * One line for a clip that is getting ready: "Understanding · step 2 of 3"; the failed or
 * duplicate words alone.
 * @param view - The clip's processing view.
 * @returns The line.
 */
export function processingLine(view: ProcessingView): string {
  if (view.kind !== 'step') return view.label;
  const step = stepOfLine(view.step);
  return `${view.label} · ${step.charAt(0).toLowerCase()}${step.slice(1)}`;
}
