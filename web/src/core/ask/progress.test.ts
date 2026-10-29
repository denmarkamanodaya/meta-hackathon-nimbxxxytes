import { describe, expect, it } from 'vitest';
import type { AgentStep } from '../../services/api/types';
import { guideRowsDone, scoreOutOfTen, shortRowsDone } from './progress';

const step = (seq: number, kind: AgentStep['kind'], tool: string | null = null): AgentStep => ({
  seq,
  kind,
  tool,
  version: 1,
  summary: '',
  at: '2026-10-29T00:00:00Z',
});

describe('Ask progress', () => {
  it('ticks a short row by row from its status and steps', () => {
    expect(shortRowsDone(null, [])).toBe(0);
    expect(shortRowsDone('planning', [step(1, 'plan')])).toBe(1);
    expect(shortRowsDone('planning', [step(1, 'plan'), step(2, 'tool_call', 'render_preview')])).toBe(2);
    expect(shortRowsDone('rendering', [])).toBe(2);
    expect(shortRowsDone('critiquing', [])).toBe(3);
    expect(shortRowsDone('ready', [])).toBe(4);
    expect(shortRowsDone('planning', [step(1, 'final')])).toBe(4);
  });

  it('keeps the review row ticked while a revision renders again', () => {
    const steps = [step(1, 'plan'), step(2, 'tool_call', 'render_preview'), step(3, 'critique'), step(4, 'revise')];

    expect(shortRowsDone('rendering', steps)).toBe(3);
  });

  it('ticks a guide row per finished stage', () => {
    expect(guideRowsDone('queued', null)).toBe(0);
    expect(guideRowsDone('running', 'steps')).toBe(0);
    expect(guideRowsDone('running', 'highlight')).toBe(2);
    expect(guideRowsDone('running', 'ready')).toBe(4);
    expect(guideRowsDone('ready', null)).toBe(4);
  });

  it('says the editor score out of 10', () => {
    expect(scoreOutOfTen(41)).toBe(8);
    expect(scoreOutOfTen(50)).toBe(10);
    expect(scoreOutOfTen(0)).toBe(0);
  });
});
