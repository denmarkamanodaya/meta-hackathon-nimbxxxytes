// The dev fixture must stay a valid short: the api serves it from a debug route, and the trail
// UI must show every link in it.
import { describe, expect, it } from 'vitest';
import { linkChanges, pickBestVersion } from '../../core/agent-trail';
import { parseShortDetail } from '../../services/api/parse-shorts';
import fixture from './short.json';

const detail = parseShortDetail(fixture);

describe('short.json fixture', () => {
  it('parses as a ShortDetail', () => {
    expect(detail).not.toBeNull();
    expect(detail?.versions.map((v) => v.n)).toEqual([1, 2, 3]);
  });

  it('links every v2+ change to an existing critique note', () => {
    const versions = detail?.versions ?? [];
    const linked = versions.flatMap((version) => linkChanges(version, versions));

    expect(linked).toHaveLength(3);
    expect(linked.every((entry) => entry.note !== null)).toBe(true);
  });

  it('keeps every clip inside its segment and names the best version', () => {
    const segments = new Map(detail?.segments.map((s) => [s.segment_id, s]));
    const clips = detail?.versions.flatMap((v) => v.timeline.clips) ?? [];

    for (const clip of clips) {
      const segment = segments.get(clip.segment_id);
      expect(segment).toBeDefined();
      expect(clip.in).toBeGreaterThanOrEqual(segment?.start_s ?? Infinity);
      expect(clip.out).toBeLessThanOrEqual(segment?.end_s ?? -Infinity);
    }
    expect(pickBestVersion(detail?.versions ?? [], detail?.short.best_version ?? null)).toBe(3);
  });

  it('has strictly increasing step seq ending in final', () => {
    const seqs = detail?.steps.map((s) => s.seq) ?? [];

    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(detail?.steps.at(-1)?.kind).toBe('final');
  });
});
