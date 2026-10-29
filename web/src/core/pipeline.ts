// What the UI says about a clip while the ingest pipeline runs.
import type { ClipEvent, PipelineStep } from '../services/api/types';

const STEP_LABEL: Record<PipelineStep, string> = {
  probe: 'Checking video…',
  proxy: 'Making proxy…',
  derivatives: 'Preparing frames…',
  segments: 'Finding scenes…',
  similar: 'Checking for copies…',
  transcribe: 'Transcribing…',
  describe: 'Describing…',
  title: 'Naming the clip…',
  faces: 'Finding faces…',
  embed: 'Understanding scenes…',
  index: 'Indexing…',
  ready: 'Ready',
};

/**
 * Label for the latest step event.
 * @param event - Latest SSE event for the clip.
 * @returns A short present-tense label; a failed step reads "Stopped while <step>".
 */
export function stepLabel(event: ClipEvent): string {
  const label = STEP_LABEL[event.step];
  if (event.status === 'failed') return `Stopped while ${label.replace(/…$/, '').toLowerCase()}`;
  return label;
}
