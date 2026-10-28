// Muse Image on the wire (covers with styles, the cover title, footage boards, key art): each new
// call's outgoing request, then the parse of the answers that carry the new fields.
import { describe, expect, it, vi } from 'vitest';
import exportsPack from '../../test-support/fixtures/exports.json';
import productions from '../../test-support/fixtures/productions.json';
import projects from '../../test-support/fixtures/projects.json';
import { createApiClient } from './client';
import { parseProject } from './parse-projects';
import { parseExports, parseProductionDetail, parseProductionList } from './parse-studio';

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
  return { client, sent };
}

const [tiktok] = exportsPack.exports;
const [morning] = productions;
const [birthday] = projects;
if (tiktok === undefined || morning === undefined || birthday === undefined) throw new Error('fixtures have rows');
const [firstShot] = morning.shots;
if (firstShot === undefined) throw new Error('productions.json has shots');

const pack = (item: unknown) => ({ exports: [item], busy: false });

/** A copy of a wire body without some fields (an older answer). */
const without = (body: object, ...keys: string[]) => Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));

describe('parseExports with covers and a title', () => {
  it('reads covers with their style and redraw words, the title and the download cover', () => {
    const item = {
      ...tiktok,
      covers: [
        { url: 'a.webp', style: 'bright', instruction: null },
        { url: 'b.webp', style: 'redrawn', instruction: 'golden hour' },
        { url: 'c.webp', style: 'key_art' },
      ],
      cover_title: { text: 'Nap champion', show: true, position: 'top' },
      download_cover_url: 'titled.jpg',
    };

    expect(parseExports(pack(item))?.exports[0]).toMatchObject({
      covers: [
        { url: 'a.webp', style: 'bright', instruction: null },
        { url: 'b.webp', style: 'redrawn', instruction: 'golden hour' },
        { url: 'c.webp', style: 'key_art', instruction: null },
      ],
      cover_title: { text: 'Nap champion', show: true, position: 'top' },
      download_cover_url: 'titled.jpg',
    });
  });

  it('rejects an unknown style, a bad title position, a missing title and the old cover_urls', () => {
    expect(parseExports(pack({ ...tiktok, covers: [{ url: 'a', style: 'neon', instruction: null }] }))).toBeNull();
    expect(parseExports(pack({ ...tiktok, cover_title: { text: 'x', show: true, position: 'middle' } }))).toBeNull();
    expect(parseExports(pack({ ...tiktok, cover_title: undefined }))).toBeNull();
    expect(parseExports(pack({ ...without(tiktok, 'covers'), cover_urls: ['a'] }))).toBeNull();
  });
});

describe('footage boards and key art', () => {
  it('reads the footage board, and reads it as not drawn when an older answer leaves it out', () => {
    const drawn = { ...morning, shots: [{ ...firstShot, footage_board_url: 'footage.webp' }] };
    const older = without(firstShot, 'footage_board_url');

    expect(parseProductionDetail(drawn)?.shots[0]?.footage_board_url).toBe('footage.webp');
    expect(parseProductionDetail({ ...morning, shots: [older] })?.shots[0]?.footage_board_url).toBeNull();
    expect(parseProductionDetail({ ...morning, shots: [{ ...firstShot, footage_board_url: 7 }] })).toBeNull();
  });

  it('reads key art on a production and its list row; a wrong type rejects the body', () => {
    const withArt = { ...morning, production: { ...morning.production, art_url: 'art.webp', art_drawing: true } };
    const row = {
      production_id: 'pr_1',
      title: 'Sixty and shining',
      format: 'story',
      aspect: '4:5',
      target_s: 60,
      status: 'shooting',
      shot_count: 6,
      covered_count: 5,
      missing_titles: ['Raise the toast'],
      cover_url: null,
      created_at: '2026-10-28T00:00:00Z',
    };

    expect(parseProductionDetail(withArt)?.production).toMatchObject({ art_url: 'art.webp', art_drawing: true });
    expect(parseProductionList([row])?.[0]).toMatchObject({ art_url: null, art_drawing: false });
    expect(parseProductionList([{ ...row, art_drawing: 'yes' }])).toBeNull();
  });

  it("reads a project's art and the moments it was drawn from", () => {
    const source = { clip_id: 'c1', clip_title: 'Bondi', title: 'Cliff path opens up', start_s: 42, thumb_url: null };

    expect(parseProject({ ...birthday, art_url: 'art.webp', art_drawing: false, art_sources: [source] })).toMatchObject({
      art_url: 'art.webp',
      art_sources: [source],
    });
    expect(parseProject(without(birthday, 'art_url', 'art_drawing', 'art_sources'))).toMatchObject({ art_url: null, art_drawing: false, art_sources: [] });
    expect(parseProject({ ...birthday, art_sources: [{ ...source, start_s: 'x' }] })).toBeNull();
  });
});

describe('Muse Image endpoints: outgoing requests', () => {
  const started = { started: true };

  it('POST …/covers sends no body without a style, and the style when given', async () => {
    const plain = answering(202, started);
    await plain.client.moreCovers('sh 1', 'tiktok');
    expect(plain.sent()).toEqual({ url: '/api/shorts/sh%201/exports/tiktok/covers', method: 'POST', body: undefined });

    const styled = answering(202, started);
    expect(await styled.client.moreCovers('sh1', 'reels', 'illustrated')).toEqual(started);
    expect(styled.sent()).toEqual({ url: '/api/shorts/sh1/exports/reels/covers', method: 'POST', body: { style: 'illustrated' } });
  });

  it('POST …/covers/{n}/redraw with the words', async () => {
    const { client, sent } = answering(202, started);

    await client.redrawCover('sh1', 'shorts', 2, 'golden hour');

    expect(sent()).toEqual({ url: '/api/shorts/sh1/exports/shorts/covers/2/redraw', method: 'POST', body: { instruction: 'golden hour' } });
  });

  it('PUT …/exports/{platform} with the cover title', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await client.editExport('sh1', 'feed', { cover_title: { text: 'Old soul', show: false, position: 'top' } });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect([url, init?.method, init?.body]).toEqual([
      '/api/shorts/sh1/exports/feed',
      'PUT',
      JSON.stringify({ cover_title: { text: 'Old soul', show: false, position: 'top' } }),
    ]);
  });

  it('POST the board, art, art cover and project art paths with no body', async () => {
    const calls: [() => Promise<unknown>, string][] = [];
    const board = answering(202, started);
    calls.push([() => board.client.redrawShotBoard('pr 1', 'shot/2'), '/api/productions/pr%201/shots/shot%2F2/board']);
    const art = answering(202, started);
    calls.push([() => art.client.newProductionArt('pr1'), '/api/productions/pr1/art']);
    const cover = answering(200, started);
    calls.push([() => cover.client.useArtAsCover('pr1'), '/api/productions/pr1/art/cover']);
    const project = answering(202, started);
    calls.push([() => project.client.newProjectArt('prj1'), '/api/projects/prj1/art']);

    for (const [call] of calls) expect(await call()).toEqual(started);
    expect([board.sent(), art.sent(), cover.sent(), project.sent()]).toEqual(
      calls.map(([, url]) => ({ url, method: 'POST', body: undefined })),
    );
  });
});
