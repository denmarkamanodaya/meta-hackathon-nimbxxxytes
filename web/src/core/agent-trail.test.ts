import { describe, expect, it } from 'vitest';
import type { AgentStep, ShortVersion, Timeline } from '../services/api/types';
import { agentStepLabel, linkChanges, mergeSteps, pickBestVersion } from './agent-trail';

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
