// Wire tests for the SAM 3.1 calls (Find this, Cut out, reframe, the shot subject, the cutout
// cover) and the settings / finish / cover fields they add: request shape first, then the parse.
import { describe, expect, it, vi } from 'vitest';
import findJson from '../../test-support/fixtures/find.json';
import reframeJson from '../../test-support/fixtures/reframe.json';
import shortJson from '../../test-support/fixtures/short.json';
import { createApiClient, SAM_TIMEOUT_MS } from './client';
import { parseSettings } from './parse';
import { parseCutout, parseFind, parseReframe } from './parse-sam';
import { parseShortDetail } from './parse-shorts';
import { parseExports, parseFinish } from './parse-studio';

function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    const raw = init?.body;
    return { url, method: init?.method, body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw };
  };
  return { client, sent, fetchFn };
}

describe('POST /clips/{id}/find', () => {
  it('sends the second and the 0..1 point and reads the outline, the in-view range and the hits', async () => {
    const { client, sent } = answering(200, findJson);

    const answer = await client.findThis('clip kitchen', { t_s: 14.2, x: 0.55, y: 0.66 });

    expect(sent()).toEqual({ url: '/api/clips/clip%20kitchen/find', method: 'POST', body: { t_s: 14.2, x: 0.55, y: 0.66 } });
    expect(answer.label).toBe('mug');
    expect(answer.in_view).toEqual({ start_s: 12, end_s: 19 });
    expect(answer.outline?.frame_w).toBe(1280);
    expect(answer.hits.map((h) => h.clip_id)).toEqual(['clip_kitchen', 'clip_walk', 'clip_office']);
  });

  it('waits longer than the usual call: SAM may take up to 90 s', () => {
    expect(SAM_TIMEOUT_MS).toBeGreaterThan(90_000);
  });

  it('reads a missing or null outline as none (the tap-crop fallback) and rejects a broken one', () => {
    expect(parseFind({ ...findJson, outline: undefined })?.outline).toBeNull();
    expect(parseFind({ ...findJson, outline: null })?.outline).toBeNull();
    expect(parseFind({ ...findJson, outline: { path: 'M0 0', frame_w: 0, frame_h: 720 } })).toBeNull();
    expect(parseFind({ ...findJson, outline: { path: '', frame_w: 10, frame_h: 10 } })).toBeNull();
  });

  it('rejects an in-view range that ends before it starts, and a hit without a segment', () => {
    expect(parseFind({ ...findJson, in_view: { start_s: 5, end_s: 2 } })).toBeNull();
    expect(parseFind({ ...findJson, in_view: undefined })).toBeNull();
    expect(parseFind({ ...findJson, hits: [{ ...findJson.hits[0], segment_id: undefined }] })).toBeNull();
  });
});

describe('POST /clips/{id}/cutout', () => {
  it('sends the point and reads both PNG URLs', async () => {
    const { client, sent } = answering(200, { label: 'dog', png_url: '/c.png', sticker_url: '/s.png' });

    await expect(client.cutOut('c1', { t_s: 12, x: 0.5, y: 0.5 })).resolves.toEqual({ label: 'dog', png_url: '/c.png', sticker_url: '/s.png' });
    expect(sent()).toEqual({ url: '/api/clips/c1/cutout', method: 'POST', body: { t_s: 12, x: 0.5, y: 0.5 } });
  });

  it('rejects an answer without the sticker', () => {
    expect(parseCutout({ label: 'dog', png_url: '/c.png' })).toBeNull();
  });
});

describe('/shorts/{id}/reframe', () => {
  it('GET reads the status and each shot', async () => {
    const { client, sent } = answering(200, reframeJson);

    const answer = await client.getReframe('sh_1');

    expect(sent()).toMatchObject({ url: '/api/shorts/sh_1/reframe', method: 'GET' });
    expect(answer.status).toBe('ready');
    expect(answer.shots[1]).toEqual({ segment_id: 'seg_crossing', subject: 'the crossing', frames_tracked: 36, frames_total: 60, lost_s: 2 });
  });

  it('POST starts it with no body and reads StartedResponse', async () => {
    const { client, sent } = answering(202, { started: true });

    await expect(client.startReframe('sh_1')).resolves.toEqual({ started: true });
    expect(sent()).toEqual({ url: '/api/shorts/sh_1/reframe', method: 'POST', body: undefined });
  });

  it('rejects an unknown status', () => {
    expect(parseReframe({ status: 'done', shots: [] })).toBeNull();
    expect(parseReframe({ status: 'idle', shots: [] })).toEqual({ status: 'idle', shots: [] });
  });
});

describe('setShotSubject', () => {
  it('saves the timeline with only that clip’s subject changed', async () => {
    const detail = parseShortDetail(shortJson);
    const timeline = detail?.versions[2]?.timeline;
    if (timeline === undefined) throw new Error('fixture');
    const { client, sent } = answering(200, { version: 4 });

    await expect(client.setShotSubject('sh_1', timeline, 1, 'the red bus')).resolves.toEqual({ version: 4 });

    const body = sent().body as { timeline: { clips: { subject: string | null }[] } };
    expect(sent().url).toBe('/api/shorts/sh_1/timeline');
    expect(sent().method).toBe('PUT');
    expect(body.timeline.clips.map((c) => c.subject)).toEqual(['the latte pour', 'the red bus', 'the crossing', 'laptop opening']);
  });
});

describe('cutout covers', () => {
  it('asks for one cutout cover over a background', async () => {
    const { client, sent } = answering(202, { started: true });

    await client.moreCovers('sh_1', 'tiktok', 'cutout', 'blur');

    expect(sent()).toEqual({ url: '/api/shorts/sh_1/exports/tiktok/covers', method: 'POST', body: { style: 'cutout', background: 'blur' } });
  });

  it('keeps the old bodies: none, or a style alone', async () => {
    const bare = answering(202, { started: true });
    await bare.client.moreCovers('sh_1', 'tiktok');
    expect(bare.sent().body).toBeUndefined();

    const styled = answering(202, { started: true });
    await styled.client.moreCovers('sh_1', 'tiktok', 'bright');
    expect(styled.sent().body).toEqual({ style: 'bright' });
  });

  it('reads a cover’s background, null when absent, and rejects an unknown one', () => {
    const pack = (cover: unknown) => ({
      busy: false,
      exports: [
        {
          platform: 'tiktok',
          aspect: '9:16',
          version_n: 1,
          status: 'ready',
          render_url: null,
          caption: '',
          caption_limit: 2200,
          hashtags: [],
          covers: [cover],
          cover_pick: 0,
          cover_title: { text: 'Hi', show: false, position: 'top' },
          download_cover_url: null,
          updated_at: '2026-10-28T00:00:00Z',
        },
      ],
    });

    expect(parseExports(pack({ url: '/a', style: 'cutout', instruction: null, background: 'scene' }))?.exports[0]?.covers[0]?.background).toBe('scene');
    expect(parseExports(pack({ url: '/a', style: 'bright', instruction: null }))?.exports[0]?.covers[0]?.background).toBeNull();
    expect(parseExports(pack({ url: '/a', style: 'cutout', instruction: null, background: 'sky' }))).toBeNull();
  });
});

describe('the settings and finish fields', () => {
  it('reads blur_objects, off when an older server leaves it out', () => {
    expect(parseSettings({ face_matching: true, blur_objects: true })).toEqual({ face_matching: true, blur_objects: true });
    expect(parseSettings({ face_matching: true })).toEqual({ face_matching: true, blur_objects: false });
    expect(parseSettings({ face_matching: true, blur_objects: 'yes' })).toBeNull();
  });

  it('reads keep_subject, on when an older server leaves it out', () => {
    const finish = { blur_bystanders: true, title_text: null, speaker_colors: false, effect: 'none' };

    expect(parseFinish({ ...finish, keep_subject: false })?.keep_subject).toBe(false);
    expect(parseFinish(finish)?.keep_subject).toBe(true);
    expect(parseFinish({ ...finish, keep_subject: 1 })).toBeNull();
  });

  it('PUT /settings sends both switches', async () => {
    const { client, sent } = answering(200, { face_matching: false, blur_objects: true });

    await client.updateSettings({ face_matching: false, blur_objects: true });

    expect(sent()).toEqual({ url: '/api/settings', method: 'PUT', body: { face_matching: false, blur_objects: true } });
  });
});
