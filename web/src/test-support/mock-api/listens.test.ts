// The dev mock's iListen routes answer valid wire bodies under the API's rules, and a new
// recording walks the job on the clock to a pass on v2.
import { describe, expect, it } from 'vitest';
import { parseListen, parseListenList, parseListenStarted } from '../../services/api/parse-listens';
import { LISTEN_JOB_MS } from './listens';
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

describe('mock listens', () => {
  it('lists the five spike samples, the concert parked at Check v1', () => {
    const { api } = signedIn();
    const list = parseListenList(bodyOf(api.handle(req('GET', '/listens'))));

    expect(list?.map((each) => each.id)).toEqual(['lis_concert', 'lis_meeting', 'lis_birthday', 'lis_kyoto', 'lis_office']);
    expect(list?.[0]).toMatchObject({ status: 'listening', step: 'check', version: 1 });
  });

  it('walks a new file from upload through check v1 and v2 to ready', () => {
    const { api, clock } = signedIn();
    const created = parseListenStarted(
      bodyOf(api.handle(req('POST', '/listens', { filename: 'memo.m4a', content_type: 'audio/x-m4a', size_bytes: 10, clip_id: null, target: 'en' }))),
    );
    expect(created?.status).toBe('uploading');
    const id = created?.listen_id ?? '';
    expect(parseListenStarted(bodyOf(api.handle(req('PUT', `/listens/${id}/source`))))?.status).toBe('listening');
    expect(parseListenStarted(bodyOf(api.handle(req('POST', `/listens/${id}/complete`))))?.status).toBe('listening');

    clock.now += 1500 + 2500 + 2500 + 100;
    const checking = parseListen(bodyOf(api.handle(req('GET', `/listens/${id}`))));
    expect(checking).toMatchObject({ step: 'check', version: 1 });

    clock.now += LISTEN_JOB_MS;
    const done = parseListen(bodyOf(api.handle(req('GET', `/listens/${id}`))));
    expect(done).toMatchObject({ status: 'ready', version: 2, passed: true, source_name: 'memo.m4a' });
    expect(done?.versions.map((each) => each.passed)).toEqual([false, true]);
  });

  it('refuses a PDF and an unknown language, and re-runs understand on a language change', () => {
    const { api, clock } = signedIn();
    const pdf = api.handle(req('POST', '/listens', { filename: 'a.pdf', content_type: 'application/pdf', size_bytes: 10, clip_id: null, target: 'en' }));
    expect(pdf.kind === 'json' && pdf.status).toBe(400);
    const xx = api.handle(req('POST', '/listens', { filename: null, content_type: null, size_bytes: null, clip_id: 'c1', target: 'xx' }));
    expect(xx.kind === 'json' && xx.status).toBe(400);

    const changed = parseListen(bodyOf(api.handle(req('POST', '/listens/lis_kyoto/language', { target: 'ja' }))));
    expect(changed).toMatchObject({ status: 'listening', step: 'understand', target: 'ja' });
    clock.now += LISTEN_JOB_MS;
    expect(parseListen(bodyOf(api.handle(req('GET', '/listens/lis_kyoto'))))).toMatchObject({ status: 'ready', target: 'ja' });
  });

  it('takes a language change mid-job and starts again at understand', () => {
    const { api, clock } = signedIn();
    const created = parseListenStarted(bodyOf(api.handle(req('POST', '/listens', { filename: null, content_type: null, size_bytes: null, clip_id: 'c1', target: 'en' }))));
    const id = created?.listen_id ?? '';
    clock.now += 1500 + 2500 + 2500 + 3000;
    expect(parseListen(bodyOf(api.handle(req('GET', `/listens/${id}`))))?.step).toBe('check');

    const changed = parseListen(bodyOf(api.handle(req('POST', `/listens/${id}/language`, { target: 'zh' }))));

    expect(changed).toMatchObject({ status: 'listening', step: 'understand', target: 'zh' });
    clock.now += LISTEN_JOB_MS;
    expect(parseListen(bodyOf(api.handle(req('GET', `/listens/${id}`))))).toMatchObject({ status: 'ready', target: 'zh', source_kind: 'clip' });
  });
});
