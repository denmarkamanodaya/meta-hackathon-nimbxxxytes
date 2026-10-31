// The dev mock's Memory Lane routes answer valid wire bodies under the API's rules, a new session
// walks find → write → check → cover to ready on the clock, and the Ask box reads "remember …".
import { describe, expect, it } from 'vitest';
import { parseIntent } from '../../services/api/parse-ask';
import { parseMemory, parseMemoryList, parseMemoryStarted } from '../../services/api/parse-memories';
import { MEMORY_JOB_MS } from './memories';
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

describe('mock memories', () => {
  it('lists the finished sample with four checked moments and one fix', () => {
    const { api } = signedIn();
    const list = parseMemoryList(bodyOf(api.handle(req('GET', '/memories'))));

    expect(list?.[0]).toMatchObject({ id: 'mem_sample', status: 'ready', moment_count: 4, fixed_count: 1, viewer_name: 'Mum' });
    const detail = parseMemory(bodyOf(api.handle(req('GET', '/memories/mem_sample'))));
    expect(detail?.moments.every((moment) => moment.checked && moment.line !== '')).toBe(true);
  });

  it('walks a new person session to ready, moments found after find', () => {
    const { api, clock } = signedIn();
    const created = parseMemoryStarted(bodyOf(api.handle(req('POST', '/memories', { person_id: 'p_leo', clip_id: null, viewer_id: 'p_mum' }))));
    expect(created?.status).toBe('making');
    const id = created?.memory_id ?? '';
    const at = () => parseMemory(bodyOf(api.handle(req('GET', `/memories/${id}`))));

    expect(at()).toMatchObject({ summary: { status: 'making', step: 'find' }, moments: [] });
    clock.now += 2500;
    expect(at()?.summary.step).toBe('write');
    expect(at()?.moments).toHaveLength(4);
    clock.now += MEMORY_JOB_MS;
    expect(at()?.summary).toMatchObject({ status: 'ready', subject_name: 'Leo', viewer_name: 'Mum' });
  });

  it('refuses both or neither subject and an unknown person', () => {
    const { api } = signedIn();
    const status = (body: unknown) => {
      const reply = api.handle(req('POST', '/memories', body));
      return reply.kind === 'json' ? reply.status : 0;
    };

    expect(status({ person_id: 'p_leo', clip_id: 'clip_kitchen', viewer_id: null })).toBe(400);
    expect(status({ person_id: null, clip_id: null, viewer_id: null })).toBe(400);
    expect(status({ person_id: 'p_nobody', clip_id: null, viewer_id: null })).toBe(404);
  });

  it('reads "show Mum her memories of Leo" as memory_lane with the person and the viewer', () => {
    const { api } = signedIn();
    const intent = parseIntent(bodyOf(api.handle(req('POST', '/intents', { text: 'show Mum her memories of Leo', clip_ids: [], document_ids: [] }))));

    expect(intent).toMatchObject({ kind: 'memory_lane', person_id: 'p_leo', viewer_id: 'p_mum', clip_id: null });
  });

  it('reads "Show Mum her memories of Morning coffee pour" as a day for a viewer, titled like the API', () => {
    const { api } = signedIn();
    const intent = parseIntent(bodyOf(api.handle(req('POST', '/intents', { text: 'Show Mum her memories of Morning coffee pour', clip_ids: [], document_ids: [] }))));

    expect(intent).toMatchObject({ kind: 'memory_lane', title: 'Mum’s Morning coffee pour memories', person_id: null, clip_id: 'clip_kitchen', viewer_id: 'p_mum' });
  });
});
