// Mock-mode fixtures must stay valid wire bodies: each one goes through the real parser.
import { describe, expect, it } from 'vitest';
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList, parseCosts } from '../../services/api/parse';
import { parsePeople, parseSearch } from '../../services/api/parse-search';
import clipDetail from './clip-detail.json';
import clips from './clips.json';
import costs from './costs.json';
import people from './people.json';
import search from './search.json';

describe('mock fixtures', () => {
  it('clips.json is a clip list with mixed statuses including processing', () => {
    const parsed = parseClipList(clips);

    expect(parsed).not.toBeNull();
    expect(new Set(parsed?.map((c) => c.status))).toEqual(new Set(['ready', 'processing', 'uploaded']));
  });

  it('clip-detail.json is a clip detail with letter speakers and three tracks', () => {
    const parsed = parseClipDetail(clipDetail);

    expect(parsed).not.toBeNull();
    expect(parsed?.speakers.map((s) => s.label)).toEqual(['A', 'B']);
    expect(parsed?.tracks).toHaveLength(3);
    expect(parsed?.turns.every((t) => parsed.speakers.some((s) => s.speaker_id === t.speaker_id))).toBe(true);
  });

  it('search.json has five reranked results with reasons, on clips from clips.json', () => {
    const parsed = parseSearch(search);
    const clipIds = new Set(parseClipList(clips)?.map((c) => c.clip_id));

    expect(parsed?.reranked).toBe(true);
    expect(parsed?.results).toHaveLength(5);
    expect(parsed?.results.every((r) => r.reason !== null && clipIds.has(r.clip_id))).toBe(true);
  });

  it('people.json and costs.json parse', () => {
    expect(parsePeople(people)).toHaveLength(4);
    expect(parseCosts(costs)?.by_model).toHaveLength(3);
  });
});
