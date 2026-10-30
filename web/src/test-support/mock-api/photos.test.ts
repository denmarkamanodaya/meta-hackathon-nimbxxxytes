// The dev mock's photo routes answer valid wire bodies, a new photo is analysed on the clock, and
// search mixes photos and a moment for "60" or "red".
import { describe, expect, it } from 'vitest';
import { parsePhoto, parsePhotoList, parsePhotoStarted } from '../../services/api/parse-photos';
import { parseSearch } from '../../services/api/parse-search';
import { ANALYSE_MS } from './photos';
import { createMockApi, type MockReply, type MockRequest } from './router';

const req = (method: string, path: string, body: unknown = null): MockRequest => ({ method, path, query: new URLSearchParams(), body });

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn() {
  const clock = { now: 100_000 };
  const api = createMockApi(() => clock.now);
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  return { api, clock };
}

describe('mock photos', () => {
  it('lists the six birthday photos with small data URL pictures', () => {
    const { api } = signedIn();
    const list = parsePhotoList(bodyOf(api.handle(req('GET', '/photos'))));

    expect(list).toHaveLength(6);
    expect(list?.every((photo) => photo.thumb_url?.startsWith('data:image/jpeg;base64,') === true)).toBe(true);
    expect(parsePhoto(bodyOf(api.handle(req('GET', '/photos/ph_4210'))))?.things).toContain('gold 60 sign');
  });

  it('walks a new photo from uploading to analysing to ready', () => {
    const { api, clock } = signedIn();
    const created = parsePhotoStarted(bodyOf(api.handle(req('POST', '/photos', { filename: 'IMG_1.HEIC', content_type: 'image/heic', size_bytes: 10, last_modified: null }))));
    const id = created?.photo_id ?? '';
    expect(created?.status).toBe('uploading');

    expect(parsePhotoStarted(bodyOf(api.handle(req('PUT', `/photos/${id}/source`))))?.status).toBe('analysing');
    clock.now += ANALYSE_MS;

    expect(parsePhoto(bodyOf(api.handle(req('GET', `/photos/${id}`))))).toMatchObject({ status: 'ready', filename: 'IMG_1.HEIC' });
  });

  it('refuses a GIF, and mixes photos then a moment into a search for "60"', () => {
    const { api } = signedIn();
    const gif = api.handle(req('POST', '/photos', { filename: 'a.gif', content_type: 'image/gif', size_bytes: 10, last_modified: null }));
    expect(gif.kind === 'json' && gif.status).toBe(400);

    const answer = parseSearch(bodyOf(api.handle(req('POST', '/search', { query: 'flower backdrop with the number 60' }))));

    expect(answer?.results.map((result) => [result.kind, result.photo_id])).toEqual([
      ['photo', 'ph_4210'],
      ['photo', 'ph_4228'],
      ['moment', null],
    ]);
    expect(parseSearch(bodyOf(api.handle(req('POST', '/search', { query: 'coffee' }))))?.results.every((result) => result.kind === 'moment')).toBe(true);
  });
});
