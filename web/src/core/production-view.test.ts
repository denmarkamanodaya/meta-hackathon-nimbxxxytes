import { describe, expect, it } from 'vitest';
import {
  actLabel,
  coverageLine,
  coveragePercent,
  createdLine,
  filmItHint,
  formatChip,
  groupByAct,
  hasStoryShort,
  matchLine,
  planProgress,
  productionMeta,
  productionTitleProblem,
  shotHead,
  tidyProductionTitle,
  toFilmChip,
} from './production-view';

describe('a production title', () => {
  it('is trimmed with inner whitespace collapsed, as the API stores it', () => {
    expect(tidyProductionTitle('  Night \t  walk \n')).toBe('Night walk');
  });

  it('is 1 to 80 characters once tidied', () => {
    expect(productionTitleProblem('  Night   walk ')).toBeNull();
    expect(productionTitleProblem('é'.repeat(80))).toBeNull();
    expect(productionTitleProblem('   ')).toBe('Give the production a title.');
    expect(productionTitleProblem('a'.repeat(81))).toBe('Use 80 characters or fewer.');
    expect(productionTitleProblem(`${'a'.repeat(40)}     ${'b'.repeat(39)}`)).toBeNull();
  });
});

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

describe('the Mac production lines', () => {
  it('reads format, length, aspect and status in the header', () => {
    expect(productionMeta({ format: 'story', target_s: 60, aspect: '4:5', status: 'shooting' })).toBe('Story · 60 s · 4:5 · Shooting');
  });

  it('names the matched clip and range, and the takes only when there is more than one', () => {
    const match = { clip_title: '60th birthday', start_s: 149, end_s: 156 };

    expect(matchLine(match, 4)).toBe('60th birthday · 2:29–2:36 · 4 takes');
    expect(matchLine(match, 1)).toBe('60th birthday · 2:29–2:36');
  });

  it('heads the selected shot with its number, act and length', () => {
    expect(shotHead({ ord: 5, act: 'payoff', duration_s: 10.6 })).toBe('Shot 5 · payoff · 11 s');
  });

  it('tells what to film from the first tip, else the direction', () => {
    expect(filmItHint({ tips: ['Lift glass into frame', 'Cheer'], direction: 'Raise glass' })).toBe('Lift glass into frame');
    expect(filmItHint({ tips: [], direction: 'Raise glass' })).toBe('Raise glass');
  });

  it('has a story short once cut, until the server moves it back to shooting', () => {
    expect(['cutting', 'ready', 'published'].every((s) => hasStoryShort(s as 'ready'))).toBe(true);
    expect(['planning', 'shooting', 'failed'].some((s) => hasStoryShort(s as 'ready'))).toBe(false);
  });

  it('says when it was made and whether its short is cut', () => {
    expect(createdLine('2026-10-28T02:00:00Z', 'ready', 'UTC')).toBe('Created 28 Oct 2026 · short cut');
    expect(createdLine('2026-10-28T02:00:00Z', 'shooting', 'UTC')).toBe('Created 28 Oct 2026');
  });

  it('names the first shot still to film, and how many more', () => {
    expect(toFilmChip(['Raise the toast'])).toBe('To film: Raise the toast');
    expect(toFilmChip(['Raise the toast', 'Hug', 'Wave'])).toBe('To film: Raise the toast +2');
    expect(toFilmChip([])).toBeNull();
  });
});
