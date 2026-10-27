// Wire tests for the duplicate and face-matching calls: request shape first, then the parse.
import { describe, expect, it, vi } from 'vitest';
import clips from '../../test-support/fixtures/clips.json';
import { createApiClient } from './client';
import { parseClip, parseSettings, parseUploadCheck } from './parse';

function answering(status: number, json: unknown) {
  const body = json === undefined ? null : JSON.stringify(json);
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    const raw = init?.body;
    return { url, method: init?.method, body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw };
  };
  return { client, sent };
}

describe('POST /uploads/check', () => {
  it('sends the filename and size in the body, never the URL, and reads a match', async () => {
    const { client, sent } = answering(200, { duplicate_of: { clip_id: 'clip_kitchen', title: 'Morning coffee pour' } });

    const answer = await client.checkUpload({ filename: 'att.GrKq0.mp4', size_bytes: 3_732_228 });

    expect(sent()).toEqual({
      url: '/api/uploads/check',
      method: 'POST',
      body: { filename: 'att.GrKq0.mp4', size_bytes: 3_732_228 },
    });
    expect(answer.duplicate_of?.title).toBe('Morning coffee pour');
  });

  it('reads no match as null and rejects a match without a title', () => {
    expect(parseUploadCheck({ duplicate_of: null })).toEqual({ duplicate_of: null });
    expect(parseUploadCheck({ duplicate_of: { clip_id: 'c1' } })).toBeNull();
    expect(parseUploadCheck({})).toBeNull();
  });
});

describe('DELETE /clips/{id}', () => {
  it('sends DELETE with the id escaped and resolves on 204', async () => {
    const { client, sent } = answering(204, undefined);

    await expect(client.deleteClip('clip a/b')).resolves.toBe(true);
    expect(sent()).toEqual({ url: '/api/clips/clip%20a%2Fb', method: 'DELETE', body: undefined });
  });
});

describe('DELETE /shorts/{id}', () => {
  it('sends DELETE with the id escaped and resolves on 204', async () => {
    const { client, sent } = answering(204, undefined);

    await expect(client.deleteShort('short a/b')).resolves.toBe(true);
    expect(sent()).toEqual({ url: '/api/shorts/short%20a%2Fb', method: 'DELETE', body: undefined });
  });
});

describe('POST /tracks/name', () => {
  it('names every track of a group in one call', async () => {
    const { client, sent } = answering(204, undefined);

    await client.nameTracks(['tr_dog_walk', 'tr_dog_park'], 'Biscuit');

    expect(sent()).toEqual({
      url: '/api/tracks/name',
      method: 'POST',
      body: { track_ids: ['tr_dog_walk', 'tr_dog_park'], name: 'Biscuit' },
    });
  });
});

describe('GET and PUT /settings', () => {
  it('reads the setting and saves it as a boolean body', async () => {
    const read = answering(200, { face_matching: false });
    await expect(read.client.getSettings()).resolves.toEqual({ face_matching: false });
    expect(read.sent()).toMatchObject({ url: '/api/settings', method: 'GET' });

    const save = answering(200, { face_matching: true });
    await expect(save.client.updateSettings({ face_matching: true })).resolves.toEqual({ face_matching: true });
    expect(save.sent()).toEqual({ url: '/api/settings', method: 'PUT', body: { face_matching: true } });
  });

  it('rejects a setting that is not a boolean', () => {
    expect(parseSettings({ face_matching: 1 })).toBeNull();
  });
});

describe('parseClip duplicate_of', () => {
  it('reads the original of a duplicate and requires the field', () => {
    const copy = clips.find((c) => c.status === 'duplicate');
    const missing: Record<string, unknown> = { ...clips[0] };
    delete missing.duplicate_of;

    expect(parseClip(copy)?.duplicate_of).toBe('clip_kitchen');
    expect(parseClip(missing)).toBeNull();
  });
});
