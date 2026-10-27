import { describe, expect, it } from 'vitest';
import type { ClipSummary, Track } from '../services/api/types';
import { clipMetaLine, isInProgress, pickLiveClips, speakerName, visibleTracks } from './clip-view';

const row = (clip_id: string, status: ClipSummary['status']): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: null,
  recorded_at: null,
  status,
  thumb_url: null,
  segment_count: 0,
  people: [],
    duplicate_of: null,
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
    expect(speakerName({ speaker_id: 's', label: 'A', display_name: 'Sam' })).toBe('Sam');
  });

  it('names an unnamed speaker by its letter label, with no renumbering', () => {
    expect(speakerName({ speaker_id: 's', label: 'A', display_name: null })).toBe('Speaker A');
    expect(speakerName({ speaker_id: 's', label: 'B', display_name: '  ' })).toBe('Speaker B');
  });

  it('reads just "Speaker" when the label is blank', () => {
    expect(speakerName({ speaker_id: 's', label: ' ', display_name: null })).toBe('Speaker');
  });
});

describe('visibleTracks', () => {
  it('drops hidden tracks and orders by first appearance', () => {
    const tracks = [track('late', 9), track('gone', 1, true), track('early', 2)];

    expect(visibleTracks(tracks).map((t) => t.track_id)).toEqual(['early', 'late']);
  });
});

describe('clipMetaLine', () => {
  it('joins when, duration and counts, skipping what is missing', () => {
    expect(clipMetaLine({ when: 'Today 7:42 am', duration: '0:42', moments: 4, people: 2 })).toBe(
      'Today 7:42 am · 0:42 · 4 moments · 2 people',
    );
    expect(clipMetaLine({ when: '', duration: '0:42', moments: 1, people: 1 })).toBe('0:42 · 1 moment · 1 person');
    expect(clipMetaLine({ when: 'Sat 9:00 am', duration: '', moments: 0, people: 0 })).toBe('Sat 9:00 am');
  });
});
