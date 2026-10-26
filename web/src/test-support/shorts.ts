// Builders for shorts test data, shaped exactly as the api is asked to send them.
import type { ShortDetail, ShortVersion, Timeline } from '../services/api/types';

/** A v1 timeline (no revision) with two clips. */
export const timelineV1 = (): Timeline => ({
  aspect: '4:5',
  target_seconds: 15,
  clips: [
    { segment_id: 's3', in: 12.6, out: 15.8, subject: 'the latte art', punch_in: 1, reason: 'Strongest visual hook' },
    { segment_id: 's7', in: 40, out: 44, subject: null, punch_in: 1, reason: 'Street walk for pace' },
  ],
  captions: { style: 'phrase', source: 'transcript' },
  post: { caption: 'Slow mornings', hashtags: ['#pov'] },
  rationale: 'Open on the latte pour for the hook, then the street walk for pace.',
  revision: null,
});

/** A version with a critique scoring `total`. */
export const versionWith = (n: number, total: number | null, timeline: Timeline = timelineV1()): ShortVersion => ({
  n,
  timeline,
  preview_url: `https://s3/previews/v${String(n)}.mp4`,
  critique:
    total === null
      ? null
      : {
          version: n,
          scores: { hook: 6, pacing: 5, continuity: 7, captions: 8, length: 9 },
          total,
          notes: [{ at: 2.4, issue: 'Second shot repeats the first angle', fix: 'Swap s7 for s9' }],
          verdict: 'revise',
        },
  score_total: total,
});

/** A whole `GET /shorts/{id}` body. */
export const shortDetail = (overrides: Partial<ShortDetail['short']> = {}): ShortDetail => ({
  short: {
    short_id: 'sh1',
    prompt: '15-second reel of my morning',
    aspect: '4:5',
    target_s: 15,
    status: 'ready',
    best_version: 1,
    render_url: null,
    ...overrides,
  },
  versions: [versionWith(1, 35)],
  steps: [{ seq: 1, kind: 'plan', tool: null, version: null, summary: 'Picked 2 shots', at: '2026-11-01T10:00:00Z' }],
  segments: [
    { segment_id: 's3', clip_id: 'c1', start_s: 10, end_s: 20, thumb_url: null, description: 'Latte pour' },
    { segment_id: 's7', clip_id: 'c2', start_s: 38, end_s: 46, thumb_url: null, description: 'Street walk' },
  ],
});
