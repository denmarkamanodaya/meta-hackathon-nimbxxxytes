// Wire tests for the photo calls: the exact request first, then the parse of the fixture.
import { describe, expect, it, vi } from 'vitest';
import photosJson from '../../test-support/fixtures/photos.json';
import { createApiClient } from './client';
import { parsePhoto, parsePhotoList } from './parse-photos';

function answering(status: number, json: unknown) {
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(json === undefined ? null : JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    return { url, method: init?.method, headers: init?.headers, body: init?.body };
  };
  return { client, sent };
}

const JSON_BODY = { Accept: 'application/json', 'Content-Type': 'application/json' };
const backdrop = photosJson.find((each) => each.id === 'ph_4210');

describe('photo calls', () => {
  it('registers a photo with every key, then PUTs the raw image with its type', async () => {
    const create = answering(201, { photo_id: 'p1', status: 'uploading' });
    await create.client.createPhoto({ filename: 'a.jpg', content_type: 'image/jpeg', size_bytes: 3, last_modified: '2026-08-19T08:42:00.000Z' });
    expect(create.sent()).toEqual({
      url: '/api/photos',
      method: 'POST',
      headers: JSON_BODY,
      body: '{"filename":"a.jpg","content_type":"image/jpeg","size_bytes":3,"last_modified":"2026-08-19T08:42:00.000Z"}',
    });

    const put = answering(202, { photo_id: 'p1', status: 'analysing' });
    const file = new File(['jpg'], 'a.jpg', { type: 'image/jpeg' });
    expect(await put.client.sendPhotoSource('p 1', file)).toEqual({ photo_id: 'p1', status: 'analysing' });
    expect(put.sent()).toEqual({ url: '/api/photos/p%201/source', method: 'PUT', headers: { Accept: 'application/json', 'Content-Type': 'image/jpeg' }, body: file });
  });

  it('reads, renames and deletes', async () => {
    const one = answering(200, backdrop);
    expect((await one.client.getPhoto('ph_4210')).things).toContain('gold 60 sign');

    const rename = answering(200, backdrop);
    await rename.client.renamePhoto('ph_4210', 'Backdrop');
    expect(rename.sent()).toEqual({ url: '/api/photos/ph_4210', method: 'PATCH', headers: JSON_BODY, body: '{"title":"Backdrop"}' });

    const remove = answering(204, undefined);
    expect(await remove.client.deletePhoto('ph_4210')).toBe(true);
    expect(remove.sent()).toMatchObject({ url: '/api/photos/ph_4210', method: 'DELETE' });
  });

  it('parses every fixture and refuses a bad status or a missing key', () => {
    expect(parsePhotoList(photosJson)).toHaveLength(6);
    expect(parsePhoto({ ...backdrop, status: 'reading' })).toBeNull();
    expect(parsePhoto({ ...backdrop, things: undefined })).toBeNull();
    expect(parsePhoto({ ...backdrop, width: 0 })).toBeNull();
  });
});
