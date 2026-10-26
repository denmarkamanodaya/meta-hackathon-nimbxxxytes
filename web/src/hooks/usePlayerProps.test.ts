import { describe, expect, it } from 'vitest';
import sampleProps from '../../../render/fixtures/props.sample.json';
import { readPlayerProps } from './usePlayerProps';

describe('readPlayerProps', () => {
  it('accepts the shared renderer fixture', () => {
    expect(readPlayerProps(sampleProps)?.clips).toHaveLength(4);
  });

  it('reads missing or contract-breaking props as null (the panel falls back to the MP4)', () => {
    expect(readPlayerProps(null)).toBeNull();
    expect(readPlayerProps({ ...sampleProps, aspect: '16:9' })).toBeNull();
    expect(readPlayerProps({ ...sampleProps, clips: [] })).toBeNull();
  });
});
