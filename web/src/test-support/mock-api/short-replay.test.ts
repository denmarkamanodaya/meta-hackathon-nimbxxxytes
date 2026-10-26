import { describe, expect, it } from 'vitest';
import { parseShortDetail } from '../../services/api/parse-shorts';
import fixture from '../fixtures/short.json';
import { shortAt, stepSchedule, visibleStepCount } from './short-replay';

const full = parseShortDetail(fixture);
if (full === null) throw new Error('short.json fixture does not parse');

describe('shortAt', () => {
  it('starts planning with one step and no version critique', () => {
    const at = shortAt(full, 0, 700);

    expect(at.steps).toHaveLength(1);
    expect(at.short.status).toBe('planning');
    expect(at.versions.map((v) => v.n)).toEqual([1]);
    expect(at.versions[0]?.critique).toBeNull();
    expect(at.short.best_version).toBeNull();
  });

  it('shows the v1 critique once its critique step is reached, and v2 once revising', () => {
    const at = shortAt(full, 5 * 700, 700);

    expect(at.steps.at(-1)?.kind).toBe('revise');
    expect(at.short.status).toBe('revising');
    expect(at.versions.map((v) => [v.n, v.score_total])).toEqual([
      [1, 32],
      [2, null],
    ]);
  });

  it('ends ready with every version and the best one', () => {
    const at = shortAt(full, 60_000, 700);

    expect(at.short.status).toBe('ready');
    expect(at.short.best_version).toBe(3);
    expect(at).toEqual(full);
  });
});

describe('stepSchedule and visibleStepCount', () => {
  it('sends steps already reached at once and the rest on their slot', () => {
    const schedule = stepSchedule(full.steps, 1500, 700);

    expect(schedule.slice(0, 4).map((e) => e.delayMs)).toEqual([0, 0, 0, 600]);
    expect(visibleStepCount(16, 1500, 700)).toBe(3);
    expect(visibleStepCount(16, 1e9, 700)).toBe(16);
  });
});
