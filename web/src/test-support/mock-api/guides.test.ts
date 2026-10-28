// The dev mock's MyWay guides answer valid wire bodies: a run walks every stage to ready, a
// second Make a guide returns the same guide, the refused guide has no steps, edits change what
// GET reads.
import { describe, expect, it } from 'vitest';
import { parseGuide, parseGuideList, parseGuideStep, parseStartGuide } from '../../services/api/parse-guides';
import { GUIDE_STAGE_MS, runAt } from './guides';
import { createMockApi, type MockReply, type MockRequest } from './router';

const req = (method: string, path: string, body: unknown = null): MockRequest => ({ method, path, query: new URLSearchParams(), body });

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn() {
  const clock = { ms: 100_000 };
  const api = createMockApi(() => clock.ms);
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  return { api, clock };
}

describe('mock guides', () => {
  it('walks a new guide queued → steps → frames → highlight → voice → ready', () => {
    const { api, clock } = signedIn();
    const started = parseStartGuide(bodyOf(api.handle(req('POST', '/clips/clip_walk/guide'))));
    // clip_walk already has the running fixture guide, so the start returns that one.
    expect(started?.guide_id).toBe('g_walk');

    const fresh = parseStartGuide(bodyOf(api.handle(req('POST', '/clips/clip_kitchen_copy/guide'))));
    expect(fresh?.status).toBe('queued');
    const seen: string[] = [];
    for (let i = 0; i <= 6; i += 1) {
      const guide = parseGuide(bodyOf(api.handle(req('GET', `/guides/${fresh?.guide_id ?? ''}`))));
      seen.push(`${guide?.status ?? 'bad'}:${String(guide?.stage)}:${String(guide?.steps.length)}`);
      clock.ms += GUIDE_STAGE_MS;
    }

    expect(seen).toEqual(['queued:null:0', 'running:steps:0', 'running:frames:0', 'running:highlight:0', 'running:voice:0', 'ready:null:4', 'ready:null:4']);
  });

  it('lists every guide as a valid list with the refused one stepless', () => {
    const { api } = signedIn();
    const list = parseGuideList(bodyOf(api.handle(req('GET', '/guides'))));
    expect(list?.map((g) => [g.id, g.status, g.step_count])).toEqual([
      ['g_kettle', 'ready', 4],
      ['g_walk', 'running', 0],
      ['g_pills', 'refused', 0],
    ]);
    const refused = parseGuide(bodyOf(api.handle(req('GET', '/guides/g_pills'))));
    expect(refused?.safety).toBe('not_supported');
    expect(refused?.safety_reason).toBe('taking medication');
  });

  it('saves an edited step and reads it back', () => {
    const { api } = signedIn();
    const step = parseGuideStep(bodyOf(api.handle(req('PATCH', '/guides/g_kettle/steps/2', { title: 'Close the lid' }))));
    expect(step?.title).toBe('Close the lid');
    const guide = parseGuide(bodyOf(api.handle(req('GET', '/guides/g_kettle'))));
    expect(guide?.steps[1]?.title).toBe('Close the lid');
    expect(api.handle(req('PATCH', '/guides/g_kettle/steps/2', { title: ' ' }))).toMatchObject({ status: 400 });
  });

  it('deletes a guide', () => {
    const { api } = signedIn();
    expect(api.handle(req('DELETE', '/guides/g_pills'))).toEqual({ kind: 'empty', status: 204 });
    expect(api.handle(req('GET', '/guides/g_pills'))).toMatchObject({ status: 404 });
  });
});

describe('runAt', () => {
  it('is queued for the first stage length, then one stage per interval', () => {
    expect(runAt(0, GUIDE_STAGE_MS - 1)).toEqual({ status: 'queued', stage: null });
    expect(runAt(0, GUIDE_STAGE_MS)).toEqual({ status: 'running', stage: 'steps' });
    expect(runAt(0, GUIDE_STAGE_MS * 5)).toEqual({ status: 'ready', stage: null });
  });
});
