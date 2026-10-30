import { describe, expect, it } from 'vitest';
import type { ClipSummary, Project } from '../services/api/types';
import { addSelectedLine, allInProject, nextProjectColor, projectCountsLine, projectFacts, projectHeaderLine, projectItemCount, projectNameProblem, shortsUsingClips } from './projects';

const project = (project_id: string, name: string, over: Partial<Project> = {}): Project => ({
  project_id,
  name,
  color: 'orange',
  clip_count: 1,
  listen_count: 0,
  document_count: 0,
  photo_count: 0,
  duration_s: 327,
  size_bytes: 3_400_000_000,
  created_at: '2026-10-27T00:00:00Z',
  art_url: null,
  art_drawing: false,
  art_sources: [],
  ...over,
});

const clip = (clip_id: string, project_ids: string[], over: Partial<ClipSummary> = {}): ClipSummary => ({
  clip_id,
  title: clip_id,
  filename: `${clip_id}.mp4`,
  duration_s: 10,
  recorded_at: null,
  status: 'ready',
  thumb_url: null,
  segment_count: 3,
  people: [],
  duplicate_of: null,
  near_copy_of: null,
  angles: 0,
  size_bytes: 1,
  project_ids,
  speech_count: 0,
  face_count: 2,
  ...over,
});

const birthday = project('p_b', '60th birthday');
const trip = project('p_t', 'Australia trip', { color: 'green' });

describe('projectNameProblem', () => {
  it('accepts a fresh trimmed name, and a project keeping its own name in another case', () => {
    expect(projectNameProblem('  Hike  ', [birthday, trip], null)).toBeNull();
    expect(projectNameProblem('australia TRIP', [birthday, trip], 'p_t')).toBeNull();
  });

  it('refuses a blank name, one over 60 characters, and a clash ignoring case', () => {
    expect(projectNameProblem('   ', [], null)).toBe('Give the segment a name.');
    expect(projectNameProblem('x'.repeat(60), [], null)).toBeNull();
    expect(projectNameProblem('x'.repeat(61), [], null)).toBe('Use 60 characters or fewer.');
    expect(projectNameProblem(' australia trip ', [birthday, trip], null)).toBe('You already have a segment with this name.');
  });
});

describe('words and checks', () => {
  it('starts a new project on the first unused colour', () => {
    expect(nextProjectColor([])).toBe('orange');
    expect(nextProjectColor([birthday, trip])).toBe('blue');
  });

  it('prints the header line and the checkbox line', () => {
    expect(projectHeaderLine(birthday)).toBe('Segment · 1 clip · 3.4 GB');
    expect(projectHeaderLine({ ...trip, clip_count: 2, size_bytes: 72_000_000 })).toBe('Segment · 2 clips · 72.0 MB');
    expect(addSelectedLine(2)).toBe('Add the 2 selected items');
    expect(addSelectedLine(1)).toBe('Add the selected item');
  });

  it('counts every kind a segment holds, leaving out kinds it has none of', () => {
    const counts = { clip_count: 3, listen_count: 2, document_count: 0, photo_count: 1 };
    expect(projectCountsLine(counts)).toBe('3 clips · 2 recordings · 1 photo');
    expect(projectCountsLine({ ...counts, clip_count: 0, document_count: 1 })).toBe('2 recordings · 1 document · 1 photo');
    expect(projectCountsLine({ clip_count: 0, listen_count: 0, document_count: 0, photo_count: 0 })).toBe('0 clips');
    expect(projectItemCount(counts)).toBe(6);
    expect(projectHeaderLine(project('p', 'P', { ...counts, size_bytes: 1_000_000 }))).toBe('Segment · 3 clips · 2 recordings · 1 photo · 1.0 MB');
  });

  it('checks a project only when every clip the menu acts on is in it', () => {
    const a = clip('a', ['p_b']);
    const b = clip('b', ['p_b', 'p_t']);

    expect(allInProject([a.project_ids, b.project_ids], 'p_b')).toBe(true);
    expect(allInProject([a.project_ids, b.project_ids], 'p_t')).toBe(false);
    expect(allInProject([], 'p_b')).toBe(false);
  });

  it('counts the shorts cut from any of the project clips, once each', () => {
    const shorts = [
      { segments: [{ clip_id: 'a' }, { clip_id: 'a' }, { clip_id: 'x' }] },
      { segments: [{ clip_id: 'x' }] },
      { segments: [{ clip_id: 'b' }] },
      { segments: [] },
    ];

    expect(shortsUsingClips(shorts, ['a', 'b'])).toBe(2);
    expect(shortsUsingClips(shorts, [])).toBe(0);
  });

  it('sums moments and faces over the clips and words the length and bytes on this Mac', () => {
    expect(projectFacts(trip, [clip('a', ['p_t']), clip('b', ['p_t'])], 40_400_000)).toEqual({
      clips: '1 · 5:27',
      moments: '6',
      faces: '4',
      onThisMac: '40.4 MB of 3.4 GB',
    });
  });
});
