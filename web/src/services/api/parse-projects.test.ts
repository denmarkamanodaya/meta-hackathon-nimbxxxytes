// Projects on the wire: each call's outgoing request first, then the parse of its answer.
import { describe, expect, it, vi } from 'vitest';
import projects from '../../test-support/fixtures/projects.json';
import clips from '../../test-support/fixtures/clips.json';
import { createApiClient } from './client';
import { parseProject, parseProjectList } from './parse-projects';

function answering(status: number, json: unknown) {
  const body = json === undefined ? null : JSON.stringify(json);
  const fetchFn = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
  const client = createApiClient({ baseUrl: '/api', timeoutMs: 5000, fetchFn });
  const sent = () => {
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    const raw = init?.body;
    return { url, method: init?.method, body: typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw };
  };
  return { client, sent };
}

const [birthday] = projects;
if (birthday === undefined) throw new Error('projects.json has projects');

describe('parseProject', () => {
  it('parses the fixture unchanged', () => {
    expect(parseProjectList(projects)).toEqual(projects);
  });

  it('rejects an unknown colour, a negative length, a fractional size and a missing date', () => {
    expect(parseProject({ ...birthday, color: 'teal' })).toBeNull();
    expect(parseProject({ ...birthday, duration_s: -1 })).toBeNull();
    expect(parseProject({ ...birthday, size_bytes: 1.5 })).toBeNull();
    expect(parseProject({ ...birthday, created_at: undefined })).toBeNull();
  });

  it('rejects the whole list when one row is malformed', () => {
    expect(parseProjectList([...projects, { ...birthday, clip_count: -1 }])).toBeNull();
  });
});

describe('Projects endpoints: outgoing requests', () => {
  it('GET /projects', async () => {
    const { client, sent } = answering(200, projects);

    expect(await client.listProjects()).toEqual(projects);
    expect(sent()).toEqual({ url: '/api/projects', method: 'GET', body: undefined });
  });

  it('GET /clips?project= with the id encoded', async () => {
    const { client, sent } = answering(200, clips);

    await client.listProjectClips('prj a/b');

    expect(sent()).toEqual({ url: '/api/clips?project=prj%20a%2Fb', method: 'GET', body: undefined });
  });

  it('POST /projects with the name, colour and selected clips', async () => {
    const { client, sent } = answering(200, birthday);

    await client.createProject({ name: 'Australia trip', color: 'green', clip_ids: ['clip_walk', 'clip_park'] });

    expect(sent()).toEqual({
      url: '/api/projects',
      method: 'POST',
      body: { name: 'Australia trip', color: 'green', clip_ids: ['clip_walk', 'clip_park'] },
    });
  });

  it('PATCH /projects/{id} with only the changed fields', async () => {
    const { client, sent } = answering(200, birthday);

    await client.updateProject('prj_birthday', { color: 'pink' });

    expect(sent()).toEqual({ url: '/api/projects/prj_birthday', method: 'PATCH', body: { color: 'pink' } });
  });

  it('POST /projects/{id}/clips with clip_ids', async () => {
    const { client, sent } = answering(200, birthday);

    await client.addProjectClips('prj_birthday', ['clip_walk']);

    expect(sent()).toEqual({ url: '/api/projects/prj_birthday/clips', method: 'POST', body: { clip_ids: ['clip_walk'] } });
  });

  it('DELETE /projects/{id} and DELETE /projects/{id}/clips/{clip_id} read a 204', async () => {
    const one = answering(204, undefined);
    expect(await one.client.deleteProject('prj_birthday')).toBe(true);
    expect(one.sent()).toEqual({ url: '/api/projects/prj_birthday', method: 'DELETE', body: undefined });

    const two = answering(204, undefined);
    expect(await two.client.removeProjectClip('prj_birthday', 'clip_walk')).toBe(true);
    expect(two.sent()).toEqual({ url: '/api/projects/prj_birthday/clips/clip_walk', method: 'DELETE', body: undefined });
  });

  it('reports a name clash as VALIDATION_FAILED', async () => {
    const { client } = answering(400, { error: { code: 'VALIDATION_FAILED', message: 'taken' } });

    await expect(client.createProject({ name: 'x', color: 'grey' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});
