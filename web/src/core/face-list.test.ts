import { describe, expect, it } from 'vitest';
import overview from '../test-support/fixtures/people-overview.json';
import type { PeopleOverview } from '../services/api/types';
import { faceCounts, faceItems, faceSpan, facesLine, filterFaces } from './face-list';

const fixture = overview as PeopleOverview;
const empty: PeopleOverview = { people: [], unnamed: [], hidden_count: 0, hidden: [] };

describe('faceItems', () => {
  it('lists named people, then faces waiting for a name, then hidden faces', () => {
    const items = faceItems(fixture);

    expect(items.map((i) => i.kind)).toEqual([
      ...fixture.people.map(() => 'named'),
      ...fixture.unnamed.map(() => 'unnamed'),
      ...fixture.hidden.map(() => 'hidden'),
    ]);
    expect(items[0]).toMatchObject({ name: 'Sam', personId: 'p_sam', trackId: null, clipCount: 14 });
    expect(items[fixture.people.length]).toMatchObject({ trackId: 'tr_neighbour', clipId: 'clip_kitchen', name: null });
  });
});

describe('chips', () => {
  it('counts each chip; All leaves the hidden faces out', () => {
    expect(faceCounts(faceItems(fixture))).toEqual({ all: 8, named: 3, unnamed: 5, hidden: 2 });
  });

  it('filters to one kind', () => {
    const items = faceItems(fixture);

    expect(filterFaces(items, 'hidden').every((i) => i.kind === 'hidden')).toBe(true);
    expect(filterFaces(items, 'all').some((i) => i.kind === 'hidden')).toBe(false);
  });
});

describe('facesLine', () => {
  it('says how many faces, in how many clips, and how many are named', () => {
    const one = {
      ...empty,
      unnamed: fixture.unnamed.slice(0, 2).map((f) => ({ ...f, clip_id: 'c1' })),
    };

    expect(facesLine(faceItems(one))).toBe('2 faces in 1 clip · none named yet');
    expect(facesLine(faceItems(fixture))).toMatch(/^8 faces in \d+ clips · 3 named$/);
  });

  it('leaves out the clips when only named people are known', () => {
    expect(facesLine(faceItems({ ...empty, people: fixture.people.slice(0, 1) }))).toBe('1 face · 1 named');
  });
});

describe('faceSpan', () => {
  it('writes the span, or one time when it rounds to one second', () => {
    expect(faceSpan(7.9, 8.6)).toBe('0:07 – 0:08');
    expect(faceSpan(16.2, 16.9)).toBe('0:16');
  });
});
