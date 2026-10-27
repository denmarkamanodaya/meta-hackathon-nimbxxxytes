// The five user-facing stages of processing a clip (the upload card's dots and its line), from
// the pipeline's eleven steps.
import type { ClipEvent, PipelineStep } from '../services/api/types';

/** Stage names in order; the card lights one dot per stage reached. */
export const INGEST_STAGES = ['Preparing video', 'Listening', 'Describing scenes', 'Finding faces', 'Indexing'] as const;

const STAGE_OF: Record<PipelineStep, number> = {
  probe: 0,
  proxy: 0,
  derivatives: 0,
  segments: 0,
  transcribe: 1,
  describe: 2,
  title: 2,
  faces: 3,
  embed: 4,
  index: 4,
  ready: 5,
};

/** Steps that share a stage but say what they do: naming runs inside the describing stage. */
const STEP_TEXT: Partial<Record<PipelineStep, string>> = { title: 'Naming the clip' };

/** Where a processing clip is, for the upload card. */
export interface IngestStage {
  /** Dots lit, 0–5. */
  done: number;
  /** "Describing scenes · finding faces next", or "Ready". */
  text: string;
}

/**
 * Stage for the latest step event; null event means queued (nothing lit yet).
 * @param event - Latest SSE step, or null.
 * @returns Dots lit and the line under them.
 */
export function ingestStage(event: ClipEvent | null): IngestStage {
  if (event === null) return { done: 0, text: 'Waiting for its turn' };
  const index = STAGE_OF[event.step];
  if (index >= INGEST_STAGES.length) return { done: INGEST_STAGES.length, text: 'Ready' };
  const current = STEP_TEXT[event.step] ?? INGEST_STAGES[index] ?? '';
  const next = INGEST_STAGES[index + 1];
  if (event.status === 'failed') return { done: index, text: `Stopped while ${current.toLowerCase()}` };
  return { done: index + 1, text: next === undefined ? current : `${current} · ${next.toLowerCase()} next` };
}

/**
 * Share of the pipeline done, for the library tile's bar.
 * @param event - Latest SSE step, or null.
 * @returns 0–1.
 */
export function ingestProgress(event: ClipEvent | null): number {
  if (event === null) return 0.05;
  return Math.min(1, (STAGE_OF[event.step] + (event.status === 'done' ? 1 : 0.5)) / INGEST_STAGES.length);
}
