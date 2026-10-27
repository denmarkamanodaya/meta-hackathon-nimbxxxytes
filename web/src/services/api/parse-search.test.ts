import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { parseSearch } from './parse-search';

/** A full `POST /search` answer as the api is asked to send it. */
const body = () => ({
  rewritten: {
    keywords: ['laugh', 'beach'],
    filters: { people: ['Sam'], speakers: [], place: 'beach', from: '2026-10-24', to: null, min_quality: null },
  },
  results: [
    {
      segment_id: 's1',
      clip_id: 'c1',
      start_s: 12.6,
      end_s: 19.2,
      thumb_url: 'https://s3/s1.jpg',
      reason: 'Sam laughs as a wave hits',
      score: 0.83,
      clip_filename: 'beach.mp4',
      clip_title: 'Beach walk',
      faces: [{ name: 'Sam', crop_url: 'https://s3/sam.jpg' }],
      recorded_at: '2026-10-25T09:00:00Z',
    },
  ],
  reranked: true,
  took_ms: 60,
  cached: true,
  cost_usd: 0,
});

/** One JSON answer; returns the client and a reader for the request it sent. */
function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, body: init?.body, headers: init?.headers };
  };
  return { client, sent };
}

describe('parseSearch', () => {
  it('parses a full answer unchanged', () => {
    expect(parseSearch(body())).toEqual(body());
  });

  it('reads omitted filter fields as no filter, and a missing reason as null only when sent as null', () => {
    const lean = { ...body(), rewritten: { keywords: [], filters: {} }, reranked: false };

    expect(parseSearch(lean)?.rewritten.filters).toEqual({
      people: [],
      speakers: [],
      place: null,
      from: null,
      to: null,
      min_quality: null,
    });
    const noReason = { ...body(), results: [{ ...body().results[0], reason: undefined }] };
    expect(parseSearch(noReason)).toBeNull();
  });

  it('rejects a wrong filter type or a result without its clip filename', () => {
    expect(parseSearch({ ...body(), rewritten: { keywords: [], filters: { people: 'Sam' } } })).toBeNull();
    expect(parseSearch({ ...body(), results: [{ ...body().results[0], clip_filename: undefined }] })).toBeNull();
  });

  it('requires the clip title, the faces list and the timing/cost meta', () => {
    expect(parseSearch({ ...body(), results: [{ ...body().results[0], clip_title: undefined }] })).toBeNull();
    expect(parseSearch({ ...body(), results: [{ ...body().results[0], faces: [{ name: 'Sam' }] }] })).toBeNull();
    expect(parseSearch({ ...body(), cached: 'yes' })).toBeNull();
    expect(parseSearch({ ...body(), took_ms: undefined })).toBeNull();
  });
});

describe('Phase 5 endpoints: outgoing requests', () => {
  it('POST /search sends the query as JSON', async () => {
    const { client, sent } = answering(200, body());

    await client.search('when Sam laughed');

    expect(sent()).toEqual({
      url: '/api/search',
      method: 'POST',
      body: '{"query":"when Sam laughed"}',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  });

  it('GET /people escapes the prefix and parses rows', async () => {
    const { client, sent } = answering(200, [{ person_id: 'p1', name: 'Sam' }]);

    await expect(client.listPeople('Sa m&')).resolves.toEqual([{ person_id: 'p1', name: 'Sam' }]);
    expect(sent().url).toBe('/api/people?prefix=Sa%20m%26');
    expect(sent().method).toBe('GET');
  });

  it('PUT /tracks/{id} sends only the fields given and parses the track', async () => {
    const track = { track_id: 't1', crop_url: null, first_s: 2, last_s: 9, person_name: 'Sam', hidden: false };
    const { client, sent } = answering(200, track);

    await expect(client.updateTrack('t1', { name: 'Sam' })).resolves.toEqual(track);
    expect(sent()).toMatchObject({ url: '/api/tracks/t1', method: 'PUT', body: '{"name":"Sam"}' });
  });

  it('PUT /tracks/{id} hides a bystander with hidden only', async () => {
    const track = { track_id: 't1', crop_url: null, first_s: 2, last_s: 9, person_name: null, hidden: true };
    const { client, sent } = answering(200, track);

    await client.updateTrack('t1', { hidden: true });

    expect(sent().body).toBe('{"hidden":true}');
  });

  it('PUT /speakers/{id} sends display_name and parses the speaker', async () => {
    const speaker = { speaker_id: 'sp1', label: 'A', display_name: 'Ana' };
    const { client, sent } = answering(200, speaker);

    await expect(client.updateSpeaker('sp1', { display_name: 'Ana' })).resolves.toEqual(speaker);
    expect(sent()).toMatchObject({ url: '/api/speakers/sp1', method: 'PUT', body: '{"display_name":"Ana"}' });
  });
});
