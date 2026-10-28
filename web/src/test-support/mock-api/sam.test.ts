import { describe, expect, it } from 'vitest';
import { parseSettings } from '../../services/api/parse';
import { parseCutout, parseFind, parseReframe } from '../../services/api/parse-sam';
import { parseShortDetail } from '../../services/api/parse-shorts';
import { parseExports, parseFinish } from '../../services/api/parse-studio';
import { createMockApi, type MockReply, type MockRequest } from './router';
import { REFRAME_MS } from './sam';
import { CUTOUT_COVER_MS, PUBLISH_MS } from './studio';

const req = (method: string, path: string, body: unknown = null): MockRequest => ({
  method,
  path,
  query: new URLSearchParams(),
  body,
});

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn() {
  const clock = { ms: 0 };
  const api = createMockApi(() => clock.ms);
  api.handle(req('POST', '/session', { passcode: 'x' }));
  return { api, clock };
}

describe('mock SAM routes', () => {
  it('finds the mug with an outline, the tapped clip first, and refuses a point off the frame', () => {
    const { api } = signedIn();

    const found = parseFind(bodyOf(api.handle(req('POST', '/clips/clip_walk/find', { t_s: 3, x: 0.5, y: 0.6 }))));

    expect(found?.label).toBe('mug');
    expect(found?.outline?.path.startsWith('M')).toBe(true);
    expect(found?.hits[0]).toMatchObject({ clip_id: 'clip_walk', clip_title: 'Walk to work' });
    expect(found?.hits.filter((h) => h.clip_id === 'clip_walk')).toHaveLength(1);
    expect(api.handle(req('POST', '/clips/clip_walk/find', { t_s: 3, x: 1.5, y: 0.6 }))).toMatchObject({ status: 400 });
    expect(api.handle(req('POST', '/clips/nope/find', { t_s: 3, x: 0.5, y: 0.6 }))).toMatchObject({ status: 404 });
  });

  it('cuts out two different images: the plain PNG and the sticker', () => {
    const { api } = signedIn();

    const cut = parseCutout(bodyOf(api.handle(req('POST', '/clips/clip_kitchen/cutout', { t_s: 1, x: 0.5, y: 0.5 }))));

    expect(cut?.png_url.startsWith('data:image/')).toBe(true);
    expect(cut?.sticker_url).not.toBe(cut?.png_url);
  });

  it('tracks a short: idle, running after POST, ready later, and idle again once a subject changes', () => {
    const { api, clock } = signedIn();
    const reframe = () => parseReframe(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/reframe'))));

    expect(reframe()?.status).toBe('idle');
    expect(bodyOf(api.handle(req('POST', '/shorts/sh_fixture/reframe')))).toEqual({ started: true });
    expect(reframe()?.status).toBe('running');
    expect(bodyOf(api.handle(req('POST', '/shorts/sh_fixture/reframe')))).toEqual({ started: false });
    clock.ms = REFRAME_MS;
    const ready = reframe();
    expect(ready?.status).toBe('ready');
    expect(ready?.shots.map((s) => s.subject)).toEqual(['the latte pour', 'the crossing', 'laptop opening']);
    expect(ready?.shots.find((s) => s.subject === 'the crossing')?.lost_s).toBe(2);

    const detail = parseShortDetail(bodyOf(api.handle(req('GET', '/shorts/sh_fixture'))));
    const timeline = detail?.versions[detail.versions.length - 1]?.timeline;
    if (timeline === undefined) throw new Error('fixture');
    const clips = timeline.clips.map((c, i) => (i === 0 ? { ...c, subject: 'the cup' } : c));
    api.handle(req('PUT', '/shorts/sh_fixture/timeline', { timeline: { ...timeline, clips } }));

    expect(reframe()?.status).toBe('idle');
    expect(api.handle(req('GET', '/shorts/nope/reframe'))).toMatchObject({ status: 404 });
  });

  it('keeps blur_objects in the settings and keep_subject in the finish, on by default', () => {
    const { api } = signedIn();

    expect(parseSettings(bodyOf(api.handle(req('GET', '/settings'))))).toEqual({ face_matching: false, blur_objects: false });
    api.handle(req('PUT', '/settings', { face_matching: false, blur_objects: true }));
    expect(parseSettings(bodyOf(api.handle(req('GET', '/settings'))))?.blur_objects).toBe(true);

    expect(parseFinish(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/finish'))))?.keep_subject).toBe(true);
    const finish = { blur_bystanders: true, title_text: null, speaker_colors: false, effect: 'none', keep_subject: false };
    api.handle(req('PUT', '/shorts/sh_fixture/finish', finish));
    expect(parseFinish(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/finish'))))?.keep_subject).toBe(false);
  });

  it('makes one cutout cover over the asked background', () => {
    const { api, clock } = signedIn();
    api.handle(req('POST', '/shorts/sh_fixture/exports', { platforms: ['tiktok'] }));
    clock.ms = PUBLISH_MS;

    expect(bodyOf(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers', { style: 'cutout', background: 'blur' })))).toEqual({ started: true });
    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers', { style: 'cutout', background: 'sky' }))).toMatchObject({ status: 400 });
    clock.ms = PUBLISH_MS + CUTOUT_COVER_MS;

    const covers = parseExports(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/exports'))))?.exports.find((e) => e.platform === 'tiktok')?.covers;
    expect(covers?.map((c) => c.style)).toEqual(['bright', 'close_detail', 'dramatic', 'cutout']);
    expect(covers?.[3]?.background).toBe('blur');
    expect(covers?.[0]?.background).toBeNull();
  });
});
