import { describe, expect, it } from 'vitest';
import { stepLabel } from './pipeline';

describe('stepLabel', () => {
  it('names the running step in plain words', () => {
    expect(stepLabel({ step: 'proxy', status: 'running' })).toBe('Making proxy…');
    expect(stepLabel({ step: 'transcribe', status: 'running' })).toBe('Transcribing…');
    expect(stepLabel({ step: 'faces', status: 'running' })).toBe('Finding faces…');
    expect(stepLabel({ step: 'index', status: 'running' })).toBe('Indexing…');
  });

  it('says where a failed run stopped', () => {
    expect(stepLabel({ step: 'describe', status: 'failed' })).toBe('Stopped while describing');
  });
});
