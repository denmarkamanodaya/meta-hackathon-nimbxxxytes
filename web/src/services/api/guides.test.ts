// Wire tests for the MyWay guide calls: the exact request (method, path, headers, body) first,
// then the parse of the recorded fixture bytes.
import { describe, expect, it, vi } from 'vitest';
import guideJson from '../../test-support/fixtures/guide.json';
import guidesJson from '../../test-support/fixtures/guides.json';
import { createApiClient } from './client';
import { parseGuide, parseGuideList, parseGuideStep } from './parse-guides';

function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }),
    );
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, headers: init?.headers, body: init?.body, credentials: init?.credentials };
  };
  return { client, sent };
}

const JSON_ONLY = { Accept: 'application/json' };
describe('POST /clips/{id}/guide', () => {
  it('sends POST with the clip id escaped, no body, and reads the guide id', async () => {
    const { client, sent } = answering(202, { guide_id: 'g 1', status: 'running' });

    const answer = await client.startGuide('clip a/b');

    expect(sent()).toEqual({ url: '/api/clips/clip%20a%2Fb/guide', method: 'POST', headers: JSON_ONLY, body: undefined, credentials: 'include' });
    expect(answer).toEqual({ guide_id: 'g 1', status: 'running' });
  });
});

describe('GET /guides', () => {
  it('sends GET /guides and parses the recorded list', async () => {
    const { client, sent } = answering(200, guidesJson);

    const list = await client.listGuides();

    expect(sent()).toMatchObject({ url: '/api/guides', method: 'GET', headers: JSON_ONLY, body: undefined });
    expect(list.map((g) => [g.id, g.status, g.stage])).toEqual([
      ['g_kettle', 'ready', null],
      ['g_walk', 'running', 'highlight'],
      ['g_pills', 'refused', null],
    ]);
  });

  it('reads the source clip facts, and fails a row that leaves out clip_title or clip_duration_s', () => {
    const row = guidesJson[0];
    expect(parseGuideList([row])?.[0]).toMatchObject({ clip_title: 'Morning coffee pour', clip_duration_s: 28.4 });
    expect(parseGuideList([{ ...row, clip_title: null, clip_duration_s: null }])?.[0]?.clip_title).toBeNull();
    expect(parseGuideList([{ ...row, clip_title: undefined }])).toBeNull();
    expect(parseGuideList([{ ...row, clip_duration_s: undefined }])).toBeNull();
  });

  it('rejects a row with an unknown status, a stage of the wrong kind or a missing step count', () => {
    const row = guidesJson[0];
    expect(parseGuideList([{ ...row, status: 'done' }])).toBeNull();
    expect(parseGuideList([{ ...row, stage: 'rendering' }])).toBeNull();
    expect(parseGuideList([{ ...row, step_count: undefined }])).toBeNull();
  });
});

describe('GET /guides/{id}', () => {
  it('sends GET with the id escaped and parses the recorded guide, keeping null highlights', async () => {
    const { client, sent } = answering(200, guideJson);

    const guide = await client.getGuide('g/1');

    expect(sent()).toMatchObject({ url: '/api/guides/g%2F1', method: 'GET', headers: JSON_ONLY });
    expect(guide.steps).toHaveLength(4);
    expect(guide.steps[0]?.highlight).toEqual({ label: 'MAX line' });
    expect(guide.steps[3]?.highlight).toBeNull();
    expect(guide.safety_reason).toBeNull();
    expect(guide.clip_title).toBe('Morning coffee pour');
  });

  it('fails a guide that leaves out a required key, even one whose value may be null', () => {
    expect(parseGuide({ ...guideJson, safety_reason: 'taking medication' })?.safety_reason).toBe('taking medication');
    for (const key of ['safety_reason', 'clip_title', 'clip_duration_s', 'error', 'stage', 'language']) {
      expect(parseGuide({ ...guideJson, [key]: undefined }), key).toBeNull();
    }
  });

  it('rejects a step without clip_url or with a highlight that has no label', () => {
    const step = guideJson.steps[0];
    expect(parseGuideStep({ ...step, clip_url: undefined })).toBeNull();
    expect(parseGuideStep({ ...step, highlight: {} })).toBeNull();
    expect(parseGuide({ ...guideJson, safety: 'risky' })).toBeNull();
  });
});

describe('PATCH /guides/{id}/steps/{n}', () => {
  it('sends only the changed field as a JSON body and reads the step back', async () => {
    const step = { ...guideJson.steps[1], title: 'Close the lid', audio_url: null };
    const { client, sent } = answering(200, step);

    const answer = await client.editGuideStep('g_kettle', 2, { title: 'Close the lid' });

    expect(sent()).toMatchObject({
      url: '/api/guides/g_kettle/steps/2',
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"title":"Close the lid"}',
    });
    expect(answer.title).toBe('Close the lid');
  });
});

describe('PATCH /guides/{id}', () => {
  it('sends exactly the title as a JSON body and reads the whole guide back', async () => {
    const { client, sent } = answering(200, { ...guideJson, title: 'Kettle, the quick way' });

    const guide = await client.renameGuide('g/1', 'Kettle, the quick way');

    expect(sent()).toEqual({
      url: '/api/guides/g%2F1',
      method: 'PATCH',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: '{"title":"Kettle, the quick way"}',
      credentials: 'include',
    });
    expect(guide.title).toBe('Kettle, the quick way');
    expect(guide.steps).toHaveLength(4);
  });

  it('rejects with VALIDATION_FAILED when the server refuses the title', async () => {
    const { client } = answering(400, { error: { code: 'VALIDATION_FAILED', message: 'title must be 1–60 characters' } });

    await expect(client.renameGuide('g_kettle', '')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('DELETE /guides/{id}', () => {
  it('sends DELETE with no body and resolves on 204', async () => {
    const { client, sent } = answering(204, undefined);

    await expect(client.deleteGuide('g_kettle')).resolves.toBe(true);
    expect(sent()).toMatchObject({ url: '/api/guides/g_kettle', method: 'DELETE', headers: JSON_ONLY, body: undefined });
  });
});
