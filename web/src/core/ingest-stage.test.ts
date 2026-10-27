import { describe, expect, it } from 'vitest';
import { ingestProgress, ingestStage } from './ingest-stage';

describe('ingestStage', () => {
  it('lights the stage reached and names the next one', () => {
    expect(ingestStage({ step: 'describe', status: 'running' })).toEqual({ done: 3, text: 'Describing scenes · finding faces next' });
    expect(ingestStage({ step: 'proxy', status: 'running' })).toEqual({ done: 1, text: 'Preparing video · listening next' });
    expect(ingestStage({ step: 'index', status: 'running' })).toEqual({ done: 5, text: 'Indexing' });
  });

  it('names the clip inside the describing stage, with its own line', () => {
    expect(ingestStage({ step: 'title', status: 'running' })).toEqual({ done: 3, text: 'Naming the clip · finding faces next' });
    expect(ingestStage({ step: 'title', status: 'failed' })).toEqual({ done: 2, text: 'Stopped while naming the clip' });
    expect(ingestProgress({ step: 'title', status: 'done' })).toBeCloseTo(0.6);
  });

  it('says ready after the ready step, waiting before any step, and where it stopped on failure', () => {
    expect(ingestStage({ step: 'ready', status: 'done' })).toEqual({ done: 5, text: 'Ready' });
    expect(ingestStage(null)).toEqual({ done: 0, text: 'Waiting for its turn' });
    expect(ingestStage({ step: 'faces', status: 'failed' })).toEqual({ done: 3, text: 'Stopped while finding faces' });
  });
});

describe('ingestProgress', () => {
  it('grows with the stage and reaches 1 when ready', () => {
    expect(ingestProgress({ step: 'transcribe', status: 'running' })).toBeCloseTo(0.3);
    expect(ingestProgress({ step: 'ready', status: 'done' })).toBe(1);
    expect(ingestProgress(null)).toBeGreaterThan(0);
  });
});
