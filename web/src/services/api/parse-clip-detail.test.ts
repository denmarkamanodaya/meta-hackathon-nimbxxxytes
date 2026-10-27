import { describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { parseClipDetail, parseClipEvent } from './parse-clip-detail';

/** A full `GET /clips/{id}` body as the api is asked to send it. */
const body = () => ({
  clip: {
    clip_id: 'c1',
    title: 'Cafe morning',
    filename: 'cafe.mp4',
    duration_s: 42.5,
    recorded_at: '2026-10-26T08:15:00Z',
    status: 'ready',
    thumb_url: 'https://s3/t.jpg',
    segment_count: 1,
    people: ['Sam'],
    duplicate_of: null,
  },
  proxy_url: 'https://s3/p.mp4',
  segments: [
    {
      segment_id: 's1',
      idx: 0,
      start_s: 0,
      end_s: 7.5,
      description: 'Pouring milk into a latte',
      actions: ['pouring milk'],
      objects: ['latte', 'cup'],
      place: 'cafe counter',
      mood: 'calm',
      quality: 7,
      hook_score: 8,
      thumb_url: 'https://s3/s1.jpg',
    },
  ],
  turns: [{ turn_id: 't1', start_s: 1.2, end_s: 3.4, text: 'Morning!', speaker_id: 'sp1' }],
  speakers: [{ speaker_id: 'sp1', label: 'A', display_name: null }],
  tracks: [
    { track_id: 'tr1', crop_url: 'https://s3/f.jpg', first_s: 2, last_s: 9, person_name: 'Sam', hidden: false },
  ],
});

describe('parseClipDetail', () => {
  it('parses a full body unchanged', () => {
    expect(parseClipDetail(body())).toEqual(body());
  });

  it('accepts a clip still processing: no proxy, no facts yet, empty lists', () => {
    const early = {
      ...body(),
      proxy_url: null,
      segments: [
        { ...body().segments[0], description: null, place: null, mood: null, quality: null, hook_score: null, thumb_url: null },
      ],
      turns: [],
      speakers: [],
      tracks: [],
    };

    expect(parseClipDetail(early)).toEqual(early);
  });

  it('rejects a score outside 0–10, a missing hidden flag, or a missing list', () => {
    const b = body();

    expect(parseClipDetail({ ...b, segments: [{ ...b.segments[0], quality: 11 }] })).toBeNull();
    expect(parseClipDetail({ ...b, tracks: [{ ...b.tracks[0], hidden: undefined }] })).toBeNull();
    expect(parseClipDetail({ ...b, turns: undefined })).toBeNull();
  });
});

describe('parseClipEvent', () => {
  it('reads step and status from the SSE data', () => {
    expect(parseClipEvent('{"step":"faces","status":"done"}')).toEqual({ step: 'faces', status: 'done' });
  });

  it('rejects an unknown status', () => {
    expect(parseClipEvent('{"step":"faces","status":"maybe"}')).toBeNull();
  });
});

describe('getClip', () => {
  it('GETs /clips/{id} with the id escaped and parses the body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body()), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    const detail = await client.getClip('c 1');

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/clips/c%201');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(detail.segments[0]?.description).toBe('Pouring milk into a latte');
  });
});
