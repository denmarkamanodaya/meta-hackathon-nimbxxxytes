import { describe, expect, it } from 'vitest';
import type { GuideSummary } from '../services/api/types';
import {
  canPlayStep,
  fromClipLine,
  guideBadge,
  guideCount,
  guideMetaLine,
  guideTitleProblem,
  isGuideBusy,
  MAX_GUIDE_TITLE_CHARS,
  readStepParam,
  stageRows,
  stepEdit,
  stepNav,
  swipeStep,
} from './guides';

const row = (over: Partial<GuideSummary> = {}): GuideSummary => ({
  id: 'g1',
  clip_id: 'c1',
  title: 'Kettle',
  status: 'ready',
  stage: null,
  error: null,
  step_count: 4,
  cover_url: null,
  created_at: '2026-10-29T09:00:00Z',
  clip_title: null,
  clip_duration_s: null,
  ...over,
});

describe('stageRows', () => {
  it('marks the stages before the running one done and the running one now', () => {
    expect(stageRows('running', 'highlight').map((r) => r.state)).toEqual(['done', 'done', 'now', 'next', 'next']);
  });

  it('shows nothing started while queued and everything done once ready', () => {
    expect(stageRows('queued', null).every((r) => r.state === 'next')).toBe(true);
    expect(stageRows('ready', null).every((r) => r.state === 'done')).toBe(true);
  });

  it('names the model doing each stage, as the mock does', () => {
    expect(stageRows('running', 'steps').map((r) => r.model)).toEqual(['Muse Spark', 'ffmpeg', 'SAM 3.1', 'MMS-TTS', '']);
  });
});

describe('isGuideBusy', () => {
  it('is busy only while queued or running', () => {
    expect(['queued', 'running', 'ready', 'failed', 'refused'].map((s) => isGuideBusy(s as GuideSummary['status']))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe('guideCount', () => {
  it('counts the guides for the Mac header, singular for one', () => {
    expect(guideCount(1)).toBe('1 iGuide');
    expect(guideCount(3)).toBe('3 iGuides');
  });
});

describe('guideBadge and guideMetaLine', () => {
  it('says Making with the stage in words while running', () => {
    const making = row({ status: 'running', stage: 'highlight' });
    expect(guideBadge(making).label).toBe('Making');
    expect(guideMetaLine(making)).toBe('Making… circling the controls');
  });

  it('says Ready and lists the steps and the clip length', () => {
    const ready = row({ step_count: 6, clip_duration_s: 124 });
    expect(guideBadge(ready).label).toBe('Ready');
    expect(guideMetaLine(ready)).toBe('6 steps · 2:04 clip');
    expect(guideMetaLine(row({ step_count: 1 }))).toBe('1 step');
  });

  it('shows the failure message, or a plain line when there is none', () => {
    expect(guideMetaLine(row({ status: 'failed', error: 'SAM timed out' }))).toBe('SAM timed out');
    expect(guideMetaLine(row({ status: 'failed' }))).toBe('Could not be made');
    expect(guideBadge(row({ status: 'refused' })).tone).toBe('warning');
  });
});

describe('fromClipLine', () => {
  it('names the clip and its length when known', () => {
    expect(fromClipLine('Washing machine', 124)).toBe('From “Washing machine” · 2:04');
    expect(fromClipLine(null, null)).toBe('From the clip');
  });
});

describe('stepNav', () => {
  it('has no Back on the first step and no Next on the last', () => {
    expect(stepNav(1, 6)).toEqual({ n: 1, label: 'Step 1 of 6', prev: null, next: 2 });
    expect(stepNav(6, 6)).toEqual({ n: 6, label: 'Step 6 of 6', prev: 5, next: null });
  });

  it('clamps a step outside the guide', () => {
    expect(stepNav(9, 4).n).toBe(4);
    expect(stepNav(0, 4).n).toBe(1);
    expect(stepNav(1, 0)).toEqual({ n: 1, label: 'Step 1 of 1', prev: null, next: null });
  });

  it('reads a bad route segment as step 1', () => {
    expect(readStepParam('3')).toBe(3);
    expect(readStepParam('x')).toBe(1);
    expect(readStepParam('-2')).toBe(1);
    expect(readStepParam(undefined)).toBe(1);
  });
});

describe('swipeStep', () => {
  it('goes to the next step on a left swipe and back on a right one', () => {
    expect(swipeStep(-80, 5)).toBe('next');
    expect(swipeStep(80, 5)).toBe('prev');
  });

  it('ignores a short move and a mostly vertical one (a scroll)', () => {
    expect(swipeStep(-40, 0)).toBeNull();
    expect(swipeStep(-80, 60)).toBeNull();
  });
});

describe('stepEdit', () => {
  const before = { title: 'Put the lid on', instruction: 'Press the lid down.' };

  it('sends only the changed field, trimmed', () => {
    expect(stepEdit(before, { title: ' Close the lid ', instruction: 'Press the lid down.' })).toEqual({ title: 'Close the lid' });
    expect(stepEdit(before, { title: 'Put the lid on', instruction: 'Push it.' })).toEqual({ instruction: 'Push it.' });
  });

  it('sends nothing when nothing changed or a field is empty', () => {
    expect(stepEdit(before, before)).toBeNull();
    expect(stepEdit(before, { title: '  ', instruction: 'x' })).toBeNull();
  });
});

describe('guideTitleProblem', () => {
  it('accepts 1 to 60 characters after trimming, counting an emoji as one', () => {
    expect(guideTitleProblem('  Kettle  ')).toBeNull();
    expect(guideTitleProblem('x'.repeat(MAX_GUIDE_TITLE_CHARS))).toBeNull();
    expect(guideTitleProblem(`${'x'.repeat(MAX_GUIDE_TITLE_CHARS - 1)}☕`)).toBeNull();
  });

  it('asks for a title when it is empty and for fewer characters past 60', () => {
    expect(guideTitleProblem('   ')).toBe('Give the iGuide a title.');
    expect(guideTitleProblem('x'.repeat(MAX_GUIDE_TITLE_CHARS + 1))).toBe('Use 60 characters or fewer.');
  });
});

describe('canPlayStep', () => {
  it('plays when the step has a voice, a clip or both, and not when it has neither', () => {
    expect(canPlayStep({ audio_url: 'a.wav', clip_url: 'c.mp4' })).toBe(true);
    expect(canPlayStep({ audio_url: null, clip_url: 'c.mp4' })).toBe(true);
    expect(canPlayStep({ audio_url: 'a.wav', clip_url: null })).toBe(true);
    expect(canPlayStep({ audio_url: null, clip_url: null })).toBe(false);
  });
});
