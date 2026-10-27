import { describe, expect, it } from 'vitest';
import { actLabel, coverageLine, coveragePercent, formatChip, groupByAct, planProgress } from './production-view';

describe('coverageLine', () => {
  it('says how many are covered and how many are left to film', () => {
    expect(coverageLine(7, 9)).toBe('7 of 9 shots covered · 2 to film');
  });

  it('drops the "to film" part once every shot is covered', () => {
    expect(coverageLine(9, 9)).toBe('9 of 9 shots covered');
  });

  it('says the plan is still being made before it has shots', () => {
    expect(coverageLine(0, 0)).toBe('Planning the shots');
  });
});

describe('coveragePercent', () => {
  it('rounds the covered share and is 0 for an empty plan', () => {
    expect(coveragePercent(7, 9)).toBe(78);
    expect(coveragePercent(0, 0)).toBe(0);
    expect(coveragePercent(12, 9)).toBe(100);
  });
});

describe('formatChip and actLabel', () => {
  it('names the format and its length', () => {
    expect(formatChip('story', 60)).toBe('Story · 60 s');
    expect(formatChip('short', 19.6)).toBe('Short · 20 s');
  });

  it('numbers the act by its place in the story', () => {
    expect(actLabel('hook')).toBe('ACT 1 · HOOK');
    expect(actLabel('outro')).toBe('ACT 4 · OUTRO');
  });
});

describe('groupByAct', () => {
  it('groups in story order, sorts each act by ord and leaves empty acts out', () => {
    const shots = [
      { act: 'payoff' as const, ord: 5 },
      { act: 'hook' as const, ord: 2 },
      { act: 'hook' as const, ord: 1 },
    ];

    expect(groupByAct(shots)).toEqual([
      { act: 'hook', shots: [{ act: 'hook', ord: 1 }, { act: 'hook', ord: 2 }] },
      { act: 'payoff', shots: [{ act: 'payoff', ord: 5 }] },
    ]);
  });
});

describe('planProgress', () => {
  it('reads the storyboard count from the step', () => {
    expect(planProgress({ step: 'boards 3/9', status: 'running' })).toEqual({
      label: 'Drawing storyboards 3 of 9',
      fraction: 3 / 9,
    });
  });

  it('names each other step and any failure', () => {
    expect(planProgress({ step: 'shot_list', status: 'running' }).label).toBe('Writing the shot list');
    expect(planProgress({ step: 'coverage', status: 'running' }).label).toBe('Checking your library for each shot');
    expect(planProgress({ step: 'boards 2/9', status: 'failed' }).label).toBe('Planning stopped');
  });
});
