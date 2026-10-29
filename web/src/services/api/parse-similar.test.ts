// Wire tests for near-copies and same moments (Phase 29): the list item's `near_copy_of` and
// `angles`, the detail's `links`, and Keep both (`POST /clips/{id}/keep`).
import { describe, expect, it, vi } from 'vitest';
import clips from '../../test-support/fixtures/clips.json';
import { createApiClient } from './client';
import { parseClip, parseKeep } from './parse';
import { parseClipDetail, parseClipLink } from './parse-clip-detail';

const row = () => ({ ...clips[0], status: 'near_copy', near_copy_of: { clip_id: 'clip_walk', title: 'Walk to work', score: 0.94 }, angles: 0 });

describe('the clip row', () => {
  it('reads a near-copy with its original and score', () => {
    expect(parseClip(row())).toMatchObject({ status: 'near_copy', near_copy_of: { clip_id: 'clip_walk', title: 'Walk to work', score: 0.94 }, angles: 0 });
  });

  it('reads the same-moment count', () => {
    expect(parseClip({ ...row(), status: 'ready', near_copy_of: null, angles: 2 })?.angles).toBe(2);
  });

  it('reads a row from a server before near-copies as no copy and no angles', () => {
    const old: Record<string, unknown> = { ...row(), status: 'ready' };
    delete old.near_copy_of;
    delete old.angles;

    expect(parseClip(old)).toMatchObject({ near_copy_of: null, angles: 0 });
  });

  it('rejects a malformed original, a score over 1, a negative or fractional count, an unknown status', () => {
    expect(parseClip({ ...row(), near_copy_of: { clip_id: 'x' } })).toBeNull();
    expect(parseClip({ ...row(), near_copy_of: { clip_id: 'x', title: 'X', score: 1.2 } })).toBeNull();
    expect(parseClip({ ...row(), angles: -1 })).toBeNull();
    expect(parseClip({ ...row(), angles: 1.5 })).toBeNull();
    expect(parseClip({ ...row(), status: 'near-copy' })).toBeNull();
  });
});

describe('the detail links', () => {
  const link = { clip_id: 'o', title: 'Beach walk', kind: 'near_copy_of', score: 0.94, recorded_at: null, thumb_url: null, duration_s: 108 };

  it('reads each kind', () => {
    for (const kind of ['near_copy_of', 'copied_by', 'same_moment']) expect(parseClipLink({ ...link, kind })?.kind).toBe(kind);
  });

  it('rejects an unknown kind, a missing field or a score that is not a number', () => {
    expect(parseClipLink({ ...link, kind: 'angle' })).toBeNull();
    expect(parseClipLink({ ...link, duration_s: undefined })).toBeNull();
    expect(parseClipLink({ ...link, score: '0.9' })).toBeNull();
  });

  it('reads a detail without links as none, and one bad link rejects the body', () => {
    const detail = { clip: clips[0], proxy_url: null, segments: [], turns: [], speakers: [], tracks: [] };

    expect(parseClipDetail(detail)?.links).toEqual([]);
    expect(parseClipDetail({ ...detail, links: [link] })?.links).toEqual([link]);
    expect(parseClipDetail({ ...detail, links: [{ ...link, kind: 'x' }] })).toBeNull();
  });
});

describe('POST /clips/{id}/keep', () => {
  it('POSTs with the id escaped and no body, and reads the 202 answer', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ clip_id: 'c a', status: 'processing' }), { status: 202, headers: { 'Content-Type': 'application/json' } }),
      );
    const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });

    await expect(client.keepClip('c a')).resolves.toEqual({ clip_id: 'c a', status: 'processing' });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('/api/clips/c%20a/keep');
    expect(init?.method).toBe('POST');
    expect(init?.body ?? null).toBeNull();
  });

  it('reads a ready answer (a backfilled link dropped) and rejects an unknown status', () => {
    expect(parseKeep({ clip_id: 'c', status: 'ready' })).toEqual({ clip_id: 'c', status: 'ready' });
    expect(parseKeep({ clip_id: 'c' })).toBeNull();
    expect(parseKeep({ clip_id: 'c', status: 'kept' })).toBeNull();
  });
});
