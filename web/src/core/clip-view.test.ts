import { describe, expect, it } from 'vitest';
import type { ClipSummary, Track } from '../services/api/types';
import { isInProgress, pickLiveClips, speakerName, visibleTracks } from './clip-view';

const row = (clip_id: string, status: ClipSummary['status']): ClipSummary => ({
  clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: null,
  recorded_at: null,
  status,
  thumb_url: null,
  segment_count: 0,
  people: [],
});

const track = (track_id: string, first_s: number, hidden = false): Track => ({
  track_id,
  crop_url: null,
  first_s,
  last_s: first_s + 1,
  person_name: null,
  hidden,
});

describe('isInProgress', () => {
  it('is true until the clip is ready or failed', () => {
    expect(isInProgress('uploaded')).toBe(true);
    expect(isInProgress('processing')).toBe(true);
    expect(isInProgress('ready')).toBe(false);
    expect(isInProgress('failed')).toBe(false);
  });
});

describe('pickLiveClips', () => {
  it('streams only the first N clips still in progress', () => {
    const clips = [row('a', 'ready'), row('b', 'processing'), row('c', 'uploaded'), row('d', 'processing')];

    expect([...pickLiveClips(clips, 2)]).toEqual(['b', 'c']);
  });
});

describe('speakerName', () => {
  it('prefers the name the user gave', () => {
    expect(speakerName({ speaker_id: 's', label: 'SPEAKER_0', display_name: 'Sam' })).toBe('Sam');
  });

  it('numbers unnamed speakers from 1', () => {
    expect(speakerName({ speaker_id: 's', label: 'SPEAKER_0', display_name: null })).toBe('Speaker 1');
    expect(speakerName({ speaker_id: 's', label: 'SPEAKER_1', display_name: '  ' })).toBe('Speaker 2');
  });

  it('falls back to the raw label when it has no number', () => {
    expect(speakerName({ speaker_id: 's', label: 'narrator', display_name: null })).toBe('narrator');
  });
});

describe('visibleTracks', () => {
  it('drops hidden tracks and orders by first appearance', () => {
    const tracks = [track('late', 9), track('gone', 1, true), track('early', 2)];

    expect(visibleTracks(tracks).map((t) => t.track_id)).toEqual(['early', 'late']);
  });
});
