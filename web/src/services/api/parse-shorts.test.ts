import { describe, expect, it, vi } from 'vitest';
import { shortDetail, timelineV1, versionWith } from '../../test-support/shorts';
import { createApiClient } from './client';
import { parseCritique, parseShortDetail, parseStep, parseTimeline } from './parse-shorts';

/** The v1 timeline as it arrives on the wire: no `revision` key at all. */
const wireV1 = (): Record<string, unknown> => {
  const wire: Record<string, unknown> = { ...timelineV1() };
  delete wire.revision;
  return wire;
};

describe('parseTimeline', () => {
  it('reads a v1 timeline without revision as revision null', () => {
    expect(parseTimeline(wireV1())).toEqual(timelineV1());
  });

  it('reads a v2 revision, each change with the note it answers', () => {
    const v2 = {
      ...wireV1(),
      revision: {
        from_version: 1,
        changes: [{ action: 'swap', detail: 's7 → s9', why: 'Critique at 2.4 s', note_index: 0 }],
      },
    };

    expect(parseTimeline(v2)?.revision).toEqual(v2.revision);
  });

  it('rejects an unknown action, punch_in below 1, or a missing rationale', () => {
    const bad = (patch: object) => parseTimeline({ ...wireV1(), ...patch });

    expect(bad({ revision: { from_version: 1, changes: [{ action: 'explode', detail: '', why: '', note_index: null }] } })).toBeNull();
    expect(bad({ clips: [{ ...timelineV1().clips[0], punch_in: 0.5 }] })).toBeNull();
    expect(bad({ rationale: undefined })).toBeNull();
  });
});

describe('parseCritique', () => {
  const critique = () => versionWith(1, 35).critique;

  it('parses the contract example', () => {
    expect(parseCritique(critique())).toEqual(critique());
  });

  it('rejects a verdict other than accept or revise, and a score above 10', () => {
    expect(parseCritique({ ...critique(), verdict: 'maybe' })).toBeNull();
    expect(parseCritique({ ...critique(), scores: { ...critique()?.scores, hook: 11 } })).toBeNull();
  });
});

describe('parseStep and parseShortDetail', () => {
  it('reads a step with or without version', () => {
    expect(parseStep({ seq: 3, kind: 'tool_call', tool: 'render_preview', version: 1, summary: 's', at: 'x' })?.version).toBe(1);
    expect(parseStep({ seq: 3, kind: 'final', tool: null, summary: 's', at: 'x' })?.version).toBeNull();
    expect(parseStep({ seq: 3, kind: 'dance', tool: null, summary: 's', at: 'x' })).toBeNull();
  });

  it('parses a full short body, and a version still waiting for its preview and critique', () => {
    const body = shortDetail();
    const waiting = { ...body, versions: [{ ...versionWith(1, null), preview_url: null }] };

    expect(parseShortDetail(body)).toEqual(body);
    expect(parseShortDetail(waiting)?.versions[0]?.critique).toBeNull();
  });
});

describe('shorts endpoints: outgoing requests', () => {
  function answering(json: unknown) {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
    const sent = () => {
      const [url, init] = fetchFn.mock.calls[0] ?? [];
      return { url, method: init?.method, body: init?.body };
    };
    return { client, sent };
  }

  it('POST /shorts sends prompt, segment ids in pick order, aspect and target', async () => {
    const { client, sent } = answering({ short_id: 'sh1' });

    await expect(
      client.createShort({ prompt: 'my morning', segment_ids: ['s3', 's1'], aspect: '4:5', target_s: 15 }),
    ).resolves.toEqual({ short_id: 'sh1' });
    expect(sent()).toEqual({
      url: '/api/shorts',
      method: 'POST',
      body: '{"prompt":"my morning","segment_ids":["s3","s1"],"aspect":"4:5","target_s":15}',
    });
  });

  it('PUT /shorts/{id}/timeline wraps the timeline and omits a null revision', async () => {
    const { client, sent } = answering({ version: 3 });

    await expect(client.saveTimeline('sh1', timelineV1())).resolves.toEqual({ version: 3 });
    const raw = sent().body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '') as { timeline: Record<string, unknown> };
    expect(sent()).toMatchObject({ url: '/api/shorts/sh1/timeline', method: 'PUT' });
    expect(body.timeline).toEqual(wireV1());
    expect('revision' in body.timeline).toBe(false);
  });

  it('POST /shorts/{id}/render sends version_n; GET download and GET short use the escaped id', async () => {
    const render = answering({ job_id: 'j1' });
    await render.client.renderShort('sh/1', 2);
    expect(render.sent()).toEqual({ url: '/api/shorts/sh%2F1/render', method: 'POST', body: '{"version_n":2}' });

    const download = answering({ url: 'https://s3/r.mp4' });
    await expect(download.client.getDownload('sh1')).resolves.toEqual({ url: 'https://s3/r.mp4' });
    expect(download.sent()).toMatchObject({ url: '/api/shorts/sh1/download', method: 'GET' });

    const get = answering(shortDetail());
    await get.client.getShort('sh1');
    expect(get.sent()).toMatchObject({ url: '/api/shorts/sh1', method: 'GET', body: undefined });
  });
});
