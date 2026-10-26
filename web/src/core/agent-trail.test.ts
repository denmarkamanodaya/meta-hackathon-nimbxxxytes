import { describe, expect, it } from 'vitest';
import type { AgentStep, ShortVersion, Timeline } from '../services/api/types';
import {
  agentStepLabel,
  formatDelta,
  humanizeDetail,
  isRedundantSummary,
  linkChanges,
  mergeSteps,
  pickBestVersion,
  scoreDeltas,
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

const shot = (segment_id: string, subject: string | null) => ({
  segment_id,
  in: 0,
  out: 1,
  subject,
  punch_in: 1,
  reason: 'r',
});

describe('humanizeDetail', () => {
  const v1 = [shot('seg_coffee', 'the latte pour'), shot('seg_street', null), shot('seg_street_2', null), shot('seg_desk', 'laptop opening')];
  const v2 = [shot('seg_coffee', 'the latte pour'), shot('seg_street', null), shot('seg_crossing', 'the crossing'), shot('seg_desk', 'laptop opening')];

  it('names a trim by subject with start/end and m:ss.s times', () => {
    expect(humanizeDetail('seg_desk out 64.0 → 63.5', [v2, v1])).toBe('laptop opening: end 1:04.0 → 1:03.5');
    expect(humanizeDetail('seg_coffee in 2.0 → 3.0', [v2, v1])).toBe('the latte pour: start 0:02.0 → 0:03.0');
  });

  it('names a swap, using "Shot N" from the older version for a removed shot without subject', () => {
    expect(humanizeDetail('seg_street_2 → seg_crossing', [v2, v1])).toBe('Shot 3 → the crossing');
  });

  it('does not confuse an id with a longer id that starts the same', () => {
    expect(humanizeDetail('moved seg_street', [v2, v1])).toBe('moved Shot 2');
  });

  it('matches the longest id first when ids contain hyphens (UUIDs)', () => {
    const clips = [shot('0192-a', 'pour'), shot('0192-a-b', 'walk')];

    expect(humanizeDetail('0192-a-b → 0192-a', [clips])).toBe('walk → pour');
  });

  it('prefers this version\'s subject over the older one for the same shot', () => {
    const older = [shot('seg_desk', 'desk')];
    const newer = [shot('seg_desk', 'laptop opening')];

    expect(humanizeDetail('seg_desk out 64.0 → 63.5', [newer, older])).toBe('laptop opening: end 1:04.0 → 1:03.5');
  });

  it('leaves text without ids or decimals alone', () => {
    expect(humanizeDetail('tightened the captions', [v2])).toBe('tightened the captions');
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
