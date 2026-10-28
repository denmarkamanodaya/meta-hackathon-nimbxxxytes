import { describe, expect, it, vi } from 'vitest';
import peopleOverview from '../../test-support/fixtures/people-overview.json';
import shortsList from '../../test-support/fixtures/shorts-list.json';
import storage from '../../test-support/fixtures/storage.json';
import { createApiClient } from './client';
import { parsePeopleOverview, parseShortList, parseStorage } from './parse-overview';

function answering(json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, body: init?.body, credentials: init?.credentials };
  };
  return { client, sent };
}

describe('parseStorage', () => {
  it('parses the fixture unchanged and rejects a negative size', () => {
    expect(parseStorage(storage)).toEqual(storage);
    expect(parseStorage({ ...storage, resting_bytes: -1 })).toBeNull();
    expect(parseStorage({ ...storage, clip_count: 1.5 })).toBeNull();
  });

  it('reads the cap fields and rejects an unknown level or a missing cap', () => {
    expect(parseStorage({ ...storage, level: 'full' })?.level).toBe('full');
    expect(parseStorage({ ...storage, level: 'empty' })).toBeNull();
    expect(parseStorage({ ...storage, cap_bytes: undefined })).toBeNull();
    expect(parseStorage({ ...storage, used_bytes: -5 })).toBeNull();
  });
});

describe('parsePeopleOverview', () => {
  it('parses the fixture unchanged', () => {
    expect(parsePeopleOverview(peopleOverview)).toEqual(peopleOverview);
  });

  it('rejects an overview without its hidden list, or with a hidden face missing clip_title', () => {
    const without: Record<string, unknown> = { ...peopleOverview };
    delete without.hidden;
    const [first] = peopleOverview.hidden;
    if (first === undefined) throw new Error('fixture has hidden faces');
    const noTitle: Record<string, unknown> = { ...first };
    delete noTitle.clip_title;

    expect(parsePeopleOverview(without)).toBeNull();
    expect(parsePeopleOverview({ ...peopleOverview, hidden: [noTitle] })).toBeNull();
  });

  it('reads a group and a suggestion, and rejects a suggestion with similarity above 1', () => {
    const [face] = peopleOverview.unnamed;
    const bad = { ...face, suggested: { person_id: 'p_leo', name: 'Leo', similarity: 1.2 } };

    expect(parsePeopleOverview(peopleOverview)?.unnamed[0]?.suggested).toEqual({ person_id: 'p_leo', name: 'Leo', similarity: 0.91 });
    expect(parsePeopleOverview({ ...peopleOverview, unnamed: [bad] })).toBeNull();
    expect(parsePeopleOverview({ ...peopleOverview, unnamed: [{ ...face, group_id: undefined }] })).toBeNull();
  });

  it('rejects a face without on_screen_s or a person without clip_count', () => {
    expect(parsePeopleOverview({ ...peopleOverview, unnamed: [{ ...peopleOverview.unnamed[0], on_screen_s: undefined }] })).toBeNull();
    expect(parsePeopleOverview({ ...peopleOverview, people: [{ ...peopleOverview.people[0], clip_count: undefined }] })).toBeNull();
  });
});

describe('parseShortList', () => {
  it('keeps the editor draft budget when the server sends it', () => {
    const rows = parseShortList(shortsList.map((row) => ({ ...row, max_drafts: 4 })));
    expect(rows?.every((row) => row.max_drafts === 4)).toBe(true);
    expect(parseShortList(shortsList)?.[0]).not.toHaveProperty('max_drafts');
  });

  it('parses the fixture, nullable score and thumb included', () => {
    expect(parseShortList(shortsList)).toEqual(shortsList);
  });

  it('rejects an unknown status', () => {
    expect(parseShortList([{ ...shortsList[0], status: 'thinking' }])).toBeNull();
  });

  it('keeps the caption', () => {
    expect(parseShortList(shortsList)?.[0]).toMatchObject({ caption: 'Coffee first, then the city wakes up' });
  });

  it('reads a missing caption as none (older servers)', () => {
    const older: Record<string, unknown> = { ...shortsList[0] };
    delete older.caption;
    expect(parseShortList([older])?.[0]).toMatchObject({ caption: null });
  });

  it('lists a short an older server tied to a production as a plain short', () => {
    const older = { ...shortsList[0], production_id: 'pr_morning', production_title: 'My morning, coffee to desk' };
    const row = parseShortList([older])?.[0];
    expect(row).toEqual(shortsList[0]);
    expect(row).not.toHaveProperty('production_id');
  });

  it('rejects a caption that is not text', () => {
    expect(parseShortList([{ ...shortsList[0], caption: 3 }])).toBeNull();
  });
});

describe('overview endpoints: outgoing requests', () => {
  it('GET /storage, /people/overview and /shorts send no body and the session cookie', async () => {
    for (const [call, path, json] of [
      ['getStorage', '/api/storage', storage],
      ['getPeopleOverview', '/api/people/overview', peopleOverview],
      ['listShorts', '/api/shorts', shortsList],
    ] as const) {
      const { client, sent } = answering(json);
      await client[call]();
      expect(sent()).toEqual({ url: path, method: 'GET', body: undefined, credentials: 'include' });
    }
  });
});
