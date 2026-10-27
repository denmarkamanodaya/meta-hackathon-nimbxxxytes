// Mock-mode fixtures must stay valid wire bodies: each one goes through the real parser.
import { describe, expect, it } from 'vitest';
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList, parseCosts } from '../../services/api/parse';
import { parsePeopleOverview, parseShortList, parseStorage } from '../../services/api/parse-overview';
import { parsePeople, parseSearch } from '../../services/api/parse-search';
import { parseBrand, parseExports, parseProductionDetail } from '../../services/api/parse-studio';
import brand from './brand.json';
import exportsPack from './exports.json';
import productions from './productions.json';
import clipDetail from './clip-detail.json';
import clips from './clips.json';
import costs from './costs.json';
import peopleOverview from './people-overview.json';
import people from './people.json';
import search from './search.json';
import shortsList from './shorts-list.json';
import storage from './storage.json';
import projects from './projects.json';
import { parseProjectList } from '../../services/api/parse-projects';

describe('mock fixtures', () => {
  it('clips.json is a clip list with mixed statuses including processing', () => {
    const parsed = parseClipList(clips);

    expect(parsed).not.toBeNull();
    expect(new Set(parsed?.map((c) => c.status))).toEqual(new Set(['ready', 'processing', 'uploaded', 'duplicate']));
    expect(parsed?.find((c) => c.status === 'duplicate')?.duplicate_of).toBe('clip_kitchen');
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

  it('projects.json parses, and every clip project id names one of its projects', () => {
    const ids = new Set(parseProjectList(projects)?.map((p) => p.project_id));

    expect(ids.size).toBe(2);
    expect(parseClipList(clips)?.flatMap((c) => c.project_ids).every((id) => ids.has(id))).toBe(true);
  });

  it('people.json and costs.json parse', () => {
    expect(parsePeople(people)).toHaveLength(4);
    expect(parseCosts(costs)?.by_model).toHaveLength(3);
  });

  it('storage.json, people-overview.json and shorts-list.json parse', () => {
    expect(parseStorage(storage)?.clip_count).toBe(13);
    const overview = parsePeopleOverview(peopleOverview);
    expect(overview?.unnamed).toHaveLength(5);
    expect(new Set(overview?.unnamed.map((f) => f.group_id))).toEqual(new Set([null, 'g_leo', 'g_dog']));
    expect(overview?.unnamed.find((f) => f.group_id === 'g_leo')?.suggested?.name).toBe('Leo');
    expect(overview?.hidden).toHaveLength(overview?.hidden_count ?? -1);
    expect(parseShortList(shortsList)?.map((s) => s.short_id)).toEqual(['sh_fixture', 'sh_older']);
  });

  it('every clip and search result has a human title', () => {
    expect(parseClipList(clips)?.every((c) => c.title.length > 0)).toBe(true);
    expect(parseSearch(search)?.results.every((r) => r.clip_title.length > 0)).toBe(true);
  });

  it('productions.json, brand.json and exports.json parse, with a cut, a shooting and a stopped production', () => {
    const parsed = productions.map((p) => parseProductionDetail(p));

    expect(parsed.every((p) => p !== null)).toBe(true);
    expect(parsed.map((p) => p?.production.status)).toEqual(['cutting', 'shooting', 'failed']);
    expect(parsed.every((p) => p?.covered_count === p?.shots.filter((s) => s.match !== null).length)).toBe(true);
    expect(parseBrand(brand)?.kit?.colors).toHaveLength(3);
    expect(parseExports(exportsPack)?.exports.map((e) => e.platform)).toEqual(['tiktok', 'reels', 'shorts', 'feed']);
  });
});
