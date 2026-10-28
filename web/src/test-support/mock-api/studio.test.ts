// The dev mock's Muse Image flows answer valid wire bodies: styled covers, redraw, the title still,
// footage boards, production and project key art, and Use as cover.
import { describe, expect, it } from 'vitest';
import { parseProject, parseProjectList } from '../../services/api/parse-projects';
import { parseExports, parseProductionDetail, parseProductionList } from '../../services/api/parse-studio';
import { createMockApi, type MockReply, type MockRequest } from './router';
import { COVERS_MS, DRAW_MS, PUBLISH_MS, STILL_MS } from './studio';
import { PROJECT_ART_MS } from './projects';

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
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  return { api, clock };
}

describe('mock Muse Image', () => {
  it('draws three styled covers, more in a style, a redraw, and bakes the titled still', () => {
    const { api, clock } = signedIn();
    const pack = () => parseExports(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/exports'))));
    api.handle(req('POST', '/shorts/sh_fixture/exports', { platforms: ['tiktok'] }));
    clock.ms = PUBLISH_MS + STILL_MS;

    const first = pack()?.exports.find((e) => e.platform === 'tiktok');
    expect(first?.covers.map((c) => c.style)).toEqual(['bright', 'close_detail', 'dramatic']);
    expect(first?.download_cover_url).not.toBeNull();

    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers', { style: 'illustrated' }))).toMatchObject({ status: 202 });
    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers/1/redraw', { instruction: 'golden hour' }))).toMatchObject({
      status: 202,
    });
    expect(pack()?.busy).toBe(true);
    clock.ms += COVERS_MS;
    const more = pack()?.exports.find((e) => e.platform === 'tiktok');
    expect(more?.covers.slice(3)).toEqual([
      expect.objectContaining({ style: 'illustrated' }),
      expect.objectContaining({ style: 'illustrated' }),
      expect.objectContaining({ style: 'illustrated' }),
      expect.objectContaining({ style: 'redrawn', instruction: 'golden hour' }),
    ]);

    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers', { style: 'redrawn' }))).toMatchObject({ status: 400 });
    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers/0/redraw', { instruction: 'ab' }))).toMatchObject({ status: 400 });
    // Seven covers: "Make 3 more" stops at the cap of nine, then refuses.
    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers'))).toMatchObject({ status: 202 });
    clock.ms += COVERS_MS;
    expect(pack()?.exports.find((e) => e.platform === 'tiktok')?.covers).toHaveLength(9);
    expect(api.handle(req('POST', '/shorts/sh_fixture/exports/tiktok/covers'))).toMatchObject({ status: 400 });

    const title = { text: 'Nap champion', show: true, position: 'top' };
    expect(api.handle(req('PUT', '/shorts/sh_fixture/exports/tiktok', { cover_title: title }))).toEqual({ kind: 'empty', status: 204 });
    expect(pack()?.exports.find((e) => e.platform === 'tiktok')).toMatchObject({ cover_title: title, download_cover_url: null });
    expect(api.handle(req('PUT', '/shorts/sh_fixture/exports/tiktok', { cover_title: { ...title, text: 'x'.repeat(33) } }))).toMatchObject({
      status: 400,
    });
  });

  it('redraws a covered shot from footage, refuses a missing one, and draws and uses production art', () => {
    const { api, clock } = signedIn();
    const detail = () => parseProductionDetail(bodyOf(api.handle(req('GET', '/productions/pr_morning'))));
    const before = detail();
    const covered = before?.shots.find((s) => s.match !== null);
    const missing = before?.shots.find((s) => s.match === null);
    if (covered === undefined || missing === undefined) throw new Error('the fixture has covered and missing shots');
    expect(covered.footage_board_url).not.toBeNull();
    expect(missing.footage_board_url).toBeNull();
    expect(before?.production.art_url).not.toBeNull();

    expect(api.handle(req('POST', `/productions/pr_morning/shots/${missing.shot_id}/board`))).toMatchObject({ status: 400 });
    expect(api.handle(req('POST', `/productions/pr_morning/shots/${covered.shot_id}/board`))).toMatchObject({ status: 202 });
    expect(detail()?.busy).toBe(true);
    clock.ms += DRAW_MS;
    expect(detail()?.busy).toBe(false);
    expect(detail()?.shots.find((s) => s.shot_id === covered.shot_id)?.footage_board_url).not.toBe(covered.footage_board_url);

    expect(api.handle(req('POST', '/productions/pr_morning/art'))).toMatchObject({ status: 202 });
    expect(parseProductionList(bodyOf(api.handle(req('GET', '/productions'))))?.find((p) => p.production_id === 'pr_morning')?.art_drawing).toBe(true);
    clock.ms += DRAW_MS;

    expect(api.handle(req('POST', '/productions/pr_morning/art/cover'))).toMatchObject({ status: 400 });
    api.handle(req('POST', '/shorts/sh_fixture/exports', { platforms: ['tiktok'] }));
    clock.ms += PUBLISH_MS;
    expect(api.handle(req('POST', '/productions/pr_morning/art/cover'))).toMatchObject({ status: 200 });
    const pack = parseExports(bodyOf(api.handle(req('GET', '/shorts/sh_fixture/exports'))));
    expect(pack?.exports.every((e) => e.covers.at(-1)?.style === 'key_art')).toBe(true);
  });

  it('starts the trip with art and its moments, and draws new art for the birthday', () => {
    const { api, clock } = signedIn();
    const list = () => parseProjectList(bodyOf(api.handle(req('GET', '/projects'))));
    const trip = list()?.find((p) => p.project_id === 'prj_trip');
    expect(trip?.art_url).not.toBeNull();
    expect(trip?.art_sources).toHaveLength(4);
    expect(list()?.find((p) => p.project_id === 'prj_birthday')?.art_url).toBeNull();

    expect(api.handle(req('POST', '/projects/prj_birthday/art'))).toMatchObject({ status: 202 });
    expect(list()?.find((p) => p.project_id === 'prj_birthday')?.art_drawing).toBe(true);
    clock.ms += PROJECT_ART_MS;
    const drawn = list()?.find((p) => p.project_id === 'prj_birthday');
    expect(drawn).toMatchObject({ art_drawing: false });
    expect(drawn?.art_url).not.toBeNull();
    expect(drawn?.art_sources.length).toBeGreaterThan(0);
    expect(parseProject(bodyOf(api.handle(req('PATCH', '/projects/prj_birthday', { color: 'pink' }))))?.art_url).toBe(drawn?.art_url);
  });
});
