// Settings › AI and cost: the cost report as the four Meta model rows the screen lists, each with
// what it is used for. Model ids carry a version (`muse-spark-1.3`), so a row matches by prefix;
// an id no row knows is listed on its own line, so no spend is ever hidden.
import type { CostReport } from '../services/api/types';

/** One row: what it is, and what it cost. */
export interface CostRow {
  label: string;
  costUsd: number;
}

/** The rows the screen always shows, in its order, with the id prefix each one covers. */
const MODEL_ROWS = [
  { prefix: 'muse-spark', label: 'Muse Spark (titles, search, editing)' },
  { prefix: 'sam', label: 'SAM 3.1 (faces)' },
  { prefix: 'muse-voice-transcribe', label: 'Voice Transcribe (speech)' },
  { prefix: 'muse-image', label: 'Muse Image (storyboards, covers)' },
] as const;

/**
 * Groups the report into the screen's rows.
 * @param report - `GET /api/costs`.
 * @returns The four model rows (0 when unused), then any model no row covers.
 */
export function costRows(report: CostReport): CostRow[] {
  const covers = (model: string, prefix: string) => model === prefix || model.startsWith(`${prefix}-`);
  const known = MODEL_ROWS.map(({ prefix, label }) => ({
    label,
    costUsd: report.by_model.filter((row) => covers(row.model, prefix)).reduce((sum, row) => sum + row.cost_usd, 0),
  }));
  const other = report.by_model
    .filter((row) => !MODEL_ROWS.some(({ prefix }) => covers(row.model, prefix)))
    .map((row) => ({ label: row.model, costUsd: row.cost_usd }));
  return [...known, ...other];
}
