import { describe, expect, it } from 'vitest';
import type { AgentStep, ShortVersion, Timeline } from '../services/api/types';
import {
  agentStepLabel,
  draftStory,
  formatDelta,
  isListedStep,
  isRedundantSummary,
  linkChanges,
  mergeSteps,
  pickBestVersion,
  scoreDeltas,
  scoreRows,
  shortName,
} from './agent-trail';

const step = (seq: number, kind: AgentStep['kind'], tool: string | null = null, version: number | null = null): AgentStep => ({
  seq,
  kind,
  tool,
  version,
  summary: `step ${String(seq)}`,
  at: '2026-11-01T10:00:00Z',
});

const timeline = (revision: Timeline['revision']): Timeline => ({
  aspect: '4:5',
  target_seconds: 15,
  clips: [],
  captions: { style: 'phrase', source: 'transcript' },
  post: { caption: '', hashtags: [] },
  rationale: 'r',
  revision,
});

const version = (n: number, score: number | null, revision: Timeline['revision'] = null): ShortVersion => ({
  n,
  timeline: timeline(revision),
  preview_url: null,
  critique:
    score === null
      ? null
      : {
          version: n,
          scores: { hook: 5, pacing: 5, continuity: 5, captions: 5, length: 5 },
          total: score,
          notes: [
            { at: 2.4, issue: 'Second shot repeats the first angle', fix: 'Swap s7 for s9' },
            { at: 0.5, issue: 'Hook holds too long', fix: 'Trim s3' },
          ],
          verdict: 'revise',
        },
  score_total: score,
  composition_props: null,
});

describe('agentStepLabel', () => {
  it('names the agent phases the demo shows', () => {
    expect(agentStepLabel(step(1, 'plan'))).toBe('Planning…');
    expect(agentStepLabel(step(2, 'tool_call', 'render_preview', 1))).toBe('Rendering v1…');
    expect(agentStepLabel(step(3, 'tool_call', 'critique_preview', 1))).toBe('Watching v1…');
    expect(agentStepLabel(step(4, 'revise', null, 2))).toBe('Revising…');
    expect(agentStepLabel(step(5, 'final'))).toBe('Done');
  });

  it('falls back to the tool name for an unknown tool', () => {
    expect(agentStepLabel(step(1, 'tool_call', 'track_subject'))).toBe('Using track_subject…');
  });
});

describe('mergeSteps', () => {
  it('keeps one row per seq in order, live rows replacing polled ones', () => {
    const polled = [step(2, 'tool_call'), step(1, 'plan')];
    const live = [{ ...step(2, 'tool_call'), summary: 'live' }, step(3, 'critique')];

    const merged = mergeSteps(polled, live);

    expect(merged.map((s) => s.seq)).toEqual([1, 2, 3]);
    expect(merged[1]?.summary).toBe('live');
  });
});

describe('pickBestVersion', () => {
  it('trusts the server best version when it exists', () => {
    expect(pickBestVersion([version(1, 30), version(2, 40)], 1)).toBe(1);
  });

  it('else picks the highest score, the latest on a tie, and the latest when unscored', () => {
    expect(pickBestVersion([version(1, 30), version(2, 41), version(3, 41)], null)).toBe(3);
    expect(pickBestVersion([version(1, null), version(2, null)], null)).toBe(2);
    expect(pickBestVersion([], null)).toBeNull();
  });
});

describe('linkChanges', () => {
  it('pairs each change with the note of the critiqued version it answers', () => {
    const v1 = version(1, 30);
    const v2 = version(2, 38, {
      from_version: 1,
      changes: [
        { action: 'swap', detail: 's7 → s9', why: 'repeat angle', note_index: 0 },
        { action: 'trim', detail: 's3 out 15.8 → 14.9', why: 'slow hook', note_index: 1 },
        { action: 'reorder', detail: 'moved s2', why: 'flow', note_index: null },
        { action: 'add', detail: 's4', why: 'bad index', note_index: 9 },
      ],
    });

    const linked = linkChanges(v2, [v1, v2]);

    expect(linked.map((l) => l.note?.at ?? null)).toEqual([2.4, 0.5, null, null]);
    expect(linked[0]?.noteVersion).toBe(1);
  });

  it('returns nothing for a v1 without revision', () => {
    expect(linkChanges(version(1, 30), [])).toEqual([]);
  });
});

describe('scoreDeltas and formatDelta', () => {
  const critique = (total: number, hook: number) => ({
    version: 1,
    scores: { hook, pacing: 5, continuity: 5, captions: 5, length: 5 },
    total,
    notes: [],
    verdict: 'revise' as const,
  });

  it('subtracts the previous critique per score and in total', () => {
    expect(scoreDeltas(critique(39, 8), critique(32, 6))).toEqual({
      total: 7,
      scores: { hook: 2, pacing: 0, continuity: 0, captions: 0, length: 0 },
    });
  });

  it('has no deltas without a previous critique', () => {
    expect(scoreDeltas(critique(32, 6), null)).toBeNull();
  });

  it('formats up, down and unchanged', () => {
    expect(formatDelta(7)).toBe('+7');
    expect(formatDelta(-2)).toBe('−2');
    expect(formatDelta(0)).toBe('');
  });
});

describe('isRedundantSummary', () => {
  it('hides a summary that repeats the label', () => {
    expect(isRedundantSummary('Watching v1…', 'Watching v1')).toBe(true);
    expect(isRedundantSummary('Rendering v2…', '  rendering V2. ')).toBe(true);
    expect(isRedundantSummary('Planning…', '')).toBe(true);
  });

  it('keeps a summary that adds information', () => {
    expect(isRedundantSummary('Rendering v1…', 'Rendering a 540p preview')).toBe(false);
  });
});

describe('isListedStep', () => {
  it('lists timeline fit results (the clamps) and folds other tool results', () => {
    expect(isListedStep(step(1, 'tool_result', 'fit_timeline'))).toBe(true);
    expect(isListedStep(step(2, 'tool_result', 'render_preview'))).toBe(false);
    expect(isListedStep(step(3, 'plan'))).toBe(true);
    expect(agentStepLabel(step(1, 'tool_result', 'fit_timeline'))).toBe('Kept shots inside their scenes');
  });
});

describe('scoreRows', () => {
  it('lists the five bars in design order with the previous draft score', () => {
    const v1 = version(1, 25);
    const v2 = version(2, 43);
    if (v1.critique === null || v2.critique === null) throw new Error('fixture');
    const rows = scoreRows({ ...v2.critique, scores: { hook: 9, pacing: 8, continuity: 9, captions: 9, length: 8 } }, {
      ...v1.critique,
      scores: { hook: 4, pacing: 6, continuity: 5, captions: 8, length: 2 },
    });

    expect(rows.map((r) => [r.label, r.previous, r.score])).toEqual([
      ['Hook', 4, 9],
      ['Pacing', 6, 8],
      ['Flow', 5, 9],
      ['Captions', 8, 9],
      ['Length', 2, 8],
    ]);
    expect(scoreRows(v1.critique, null)[0]?.previous).toBeNull();
  });
});

describe('draftStory and shortName', () => {
  const revised = (n: number, from: number) => version(n, 40, { from_version: from, changes: [] });

  it('explains a revision with the critique of the draft it revised, and compares with draft 1', () => {
    const v1 = version(1, 25);
    const v3 = revised(3, 2);
    const v2 = revised(2, 1);

    const story = draftStory(v3, [v1, v2, v3]);

    expect(story.watched?.n).toBe(2);
    expect(story.first?.n).toBe(1);
  });

  it('explains a first draft with its own critique and nothing to compare', () => {
    const v1 = version(1, 25);

    expect(draftStory(v1, [v1])).toEqual({ watched: v1, first: null });
    expect(draftStory(version(1, null), [version(1, null)]).watched).toBeNull();
  });

  it('names a short by its post caption', () => {
    const v = version(1, 25);

    expect(shortName({ ...v, timeline: { ...v.timeline, post: { caption: 'Morning reel', hashtags: [] } } })).toBe('Morning reel');
    expect(shortName(v)).toBe('Your short');
    expect(shortName(undefined)).toBe('Your short');
  });
});
