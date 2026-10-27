import { describe, expect, it } from 'vitest';
import { processingLine, processingView } from './processing-step';

describe('processingView', () => {
  it('says Uploading (step 1) while the file goes up', () => {
    expect(processingView('uploading', null)).toEqual({ kind: 'step', step: 1, label: 'Uploading', within: 0.5 });
  });

  it('says Understanding (step 2) for every pipeline step, never the engine word', () => {
    expect(processingView('uploaded', null)).toEqual({ kind: 'step', step: 2, label: 'Understanding', within: 0 });
    for (const pipelineStep of ['probe', 'proxy', 'derivatives', 'transcribe', 'title', 'faces', 'index'] as const) {
      const view = processingView('processing', { step: pipelineStep, status: 'running' });
      expect(view).toMatchObject({ kind: 'step', step: 2, label: 'Understanding' });
    }
  });

  it('lights more of step 2 as the pipeline moves on', () => {
    const at = (pipelineStep: 'probe' | 'faces' | 'index', status: 'running' | 'done') => {
      const view = processingView('processing', { step: pipelineStep, status });
      return view.kind === 'step' ? view.within : -1;
    };

    expect(at('probe', 'running')).toBeCloseTo(0.05);
    expect(at('faces', 'running')).toBeCloseTo(0.75);
    expect(at('index', 'done')).toBe(1);
    expect(at('probe', 'running')).toBeLessThan(at('faces', 'running'));
  });

  it('says Ready (step 3) when the clip is ready, or the ready event arrives before the poll', () => {
    expect(processingView('ready', null)).toEqual({ kind: 'step', step: 3, label: 'Ready', within: 1 });
    expect(processingView('processing', { step: 'ready', status: 'done' })).toEqual({
      kind: 'step',
      step: 3,
      label: 'Ready',
      within: 1,
    });
  });

  it('keeps its own words for a failed clip and a duplicate', () => {
    expect(processingView('failed', null)).toEqual({ kind: 'failed', label: 'Could not process' });
    expect(processingView('processing', { step: 'faces', status: 'failed' })).toEqual({ kind: 'failed', label: 'Could not process' });
    expect(processingView('duplicate', null)).toEqual({ kind: 'duplicate', label: 'Duplicate' });
  });
});

describe('processingLine', () => {
  it('names the step and where it is of three', () => {
    expect(processingLine(processingView('uploading', null))).toBe('Uploading · step 1 of 3');
    expect(processingLine(processingView('processing', { step: 'faces', status: 'running' }))).toBe('Understanding · step 2 of 3');
    expect(processingLine(processingView('ready', null))).toBe('Ready · step 3 of 3');
  });

  it('keeps the failed and duplicate words alone', () => {
    expect(processingLine(processingView('failed', null))).toBe('Could not process');
    expect(processingLine(processingView('duplicate', null))).toBe('Duplicate');
  });
});
