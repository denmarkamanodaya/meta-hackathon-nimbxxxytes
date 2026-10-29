// The dev mock's Ask routes answer valid wire bodies under the API's rules.
import { describe, expect, it } from 'vitest';
import { parseIntent, parseTranscribe } from '../../services/api/parse-ask';
import { MOCK_TRANSCRIPTS } from './ask';
import { createMockApi, type MockReply, type MockRequest } from './router';

const req = (method: string, path: string, body: unknown = null): MockRequest => ({ method, path, query: new URLSearchParams(), body });

function bodyOf(reply: MockReply): unknown {
  if (reply.kind !== 'json') throw new Error(`expected json, got ${reply.kind}`);
  return reply.body;
}

function signedIn() {
  const api = createMockApi(() => 100_000);
  api.handle(req('POST', '/session', { passcode: 'anything' }));
  const intent = (text: string, clip_ids: string[] = []) => parseIntent(bodyOf(api.handle(req('POST', '/intents', { text, clip_ids }))));
  return { api, intent };
}

describe('mock ask', () => {
  it('hears its spoken requests in turn', () => {
    const { api } = signedIn();
    const first = parseTranscribe(bodyOf(api.handle(req('POST', '/transcribe'))));
    const second = parseTranscribe(bodyOf(api.handle(req('POST', '/transcribe'))));

    expect([first?.text, second?.text]).toEqual([MOCK_TRANSCRIPTS[0], MOCK_TRANSCRIPTS[1]]);
  });

  it('reads a short from a search, from added clips and from a named project', () => {
    const { intent } = signedIn();

    expect(intent('make a 45 second short of the sunsets')).toMatchObject({ kind: 'make_short', source: 'search', query: 'sunsets', target_s: 45, aspect: '4:5' });
    expect(intent('make a short', ['clip_walk'])).toMatchObject({ kind: 'make_short', source: 'attached', clip_ids: ['clip_walk'], query: null });
    expect(intent('make a short from the 60th birthday')).toMatchObject({ kind: 'make_short', source: 'project', project_id: 'prj_birthday', query: null });
    expect(intent('make a short of the cake from the 60th birthday project')).toMatchObject({ source: 'project', project_id: 'prj_birthday', query: 'cake' });
  });

  it('a guide keeps one clip; with none it asks for the task video and resends the same request', () => {
    const { intent } = signedIn();

    expect(intent('make a guide', ['clip_kitchen', 'clip_walk'])).toMatchObject({ kind: 'make_guide', clip_ids: ['clip_kitchen'], target_s: null, source: null });
    expect(intent('make a guide')).toMatchObject({ kind: 'unclear', choices: [{ label: 'Add the task video with +', text: 'make a guide' }] });
  });

  it('reads search, upload, add to project and unclear with the other keys null', () => {
    const { intent } = signedIn();

    expect(intent('coffee pour')).toMatchObject({ kind: 'search', query: 'coffee pour', source: null, target_s: null, aspect: null });
    expect(intent('upload my clips')?.kind).toBe('upload');
    expect(intent('add these to a new project called Beach', ['clip_walk'])).toMatchObject({ kind: 'add_to_project', new_project_name: 'Beach', project_id: null });
    expect(intent('add to project')?.choices[0]).toEqual({ label: 'Add clips with +', text: 'add to project' });
    expect(intent('something nice')?.choices.length).toBeGreaterThan(0);
  });

  it('refuses an empty request', () => {
    const { api } = signedIn();

    expect(api.handle(req('POST', '/intents', { text: '  ', clip_ids: [] }))).toMatchObject({ kind: 'json', status: 400 });
  });
});
