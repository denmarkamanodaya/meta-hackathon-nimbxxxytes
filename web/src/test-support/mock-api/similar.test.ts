import { describe, expect, it } from 'vitest';
import { parseClipDetail } from '../../services/api/parse-clip-detail';
import { parseClipList } from '../../services/api/parse';
import { createMockApi, type MockReply, type MockRequest } from './router';
import { KEEP_PROCESSING_MS } from './similar';

const req = (method: string, path: string): MockRequest => ({ method, path, query: new URLSearchParams(), body: null });

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn() {
  const clock = { ms: 0 };
  const api = createMockApi(() => clock.ms);
  api.handle(req('POST', '/session'));
  const list = () => parseClipList(bodyOf(api.handle(req('GET', '/clips')))) ?? [];
  const detail = (id: string) => parseClipDetail(bodyOf(api.handle(req('GET', `/clips/${id}`))));
  return { api, clock, list, detail };
}

describe('mock near-copies and same moments', () => {
  it('lists the boards’ copies: two near-copies, a duplicate, and the pier pair with one angle each', () => {
    const clips = signedIn().list();
    const byId = (id: string) => clips.find((c) => c.clip_id === id);

    expect(byId('clip_samui_export')).toMatchObject({ status: 'near_copy', near_copy_of: { clip_id: 'clip_samui', score: 0.94 } });
    expect(byId('clip_boat_480p')?.status).toBe('near_copy');
    expect(byId('clip_market_dup')).toMatchObject({ status: 'duplicate', duplicate_of: 'clip_market' });
    expect([byId('clip_pier_glasses')?.angles, byId('clip_pier_phone')?.angles]).toEqual([1, 1]);
    expect(byId('clip_samui_export')?.thumb_url).toBe(byId('clip_samui')?.thumb_url);
  });

  it('links a near-copy to its original, the original back, and the pier clips to each other', () => {
    const { detail } = signedIn();

    expect(detail('clip_samui_export')?.links.map((l) => [l.kind, l.clip_id])).toEqual([['near_copy_of', 'clip_samui']]);
    expect(detail('clip_samui')?.links.map((l) => [l.kind, l.clip_id])).toEqual([['copied_by', 'clip_samui_export']]);
    expect(detail('clip_pier_glasses')?.links).toMatchObject([{ kind: 'same_moment', clip_id: 'clip_pier_phone', recorded_at: '2026-10-20T18:12:40Z' }]);
  });

  it('keeps both: 202 processing, the link gone, then ready; refuses a clip that is not a copy', () => {
    const { api, clock, list, detail } = signedIn();

    expect(api.handle(req('POST', '/clips/clip_samui_export/keep'))).toMatchObject({ status: 202, body: { clip_id: 'clip_samui_export', status: 'processing' } });
    expect(list().find((c) => c.clip_id === 'clip_samui_export')).toMatchObject({ status: 'processing', near_copy_of: null });
    expect(detail('clip_samui')?.links).toEqual([]);
    clock.ms = KEEP_PROCESSING_MS;
    expect(list().find((c) => c.clip_id === 'clip_samui_export')?.status).toBe('ready');
    expect(api.handle(req('POST', '/clips/clip_samui/keep'))).toMatchObject({ status: 400 });
    expect(api.handle(req('POST', '/clips/nope/keep'))).toMatchObject({ status: 404 });
  });

  it('drops the angle count once the other angle is deleted', () => {
    const { api, list } = signedIn();

    api.handle(req('DELETE', '/clips/clip_pier_phone'));

    expect(list().find((c) => c.clip_id === 'clip_pier_glasses')?.angles).toBe(0);
  });
});
