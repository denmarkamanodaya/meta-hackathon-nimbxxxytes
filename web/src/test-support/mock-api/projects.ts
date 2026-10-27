// Mock Projects for the dev mocks: the project list (counts, length and size worked out from the
// clips in it, as the API does), create with the selected clips, rename and recolour, delete, and
// adding or removing clips. Membership lives on each clip's `project_ids`, so `GET /clips` and the
// project agree. Pure request → reply over the router's clip list.
import { parseProjectList } from '../../services/api/parse-projects';
import { PROJECT_COLORS, type ClipSummary, type Project, type ProjectColor } from '../../services/api/types';
import projectsJson from '../fixtures/projects.json';
import { fail, json, type MockReply, type MockRoute } from './reply';

/** Longest project name the API accepts. */
const NAME_MAX = 60;

/** The router's clip list, read and replaced through these two. */
export interface ClipAccess {
  get: () => ClipSummary[];
  set: (clips: ClipSummary[]) => void;
}

const isColor = (value: unknown): value is ProjectColor => PROJECT_COLORS.some((c) => c === value);

/**
 * Builds the Projects routes.
 * @param clips - The router's clip list.
 * @param now - Clock in ms, for `created_at`.
 * @returns The routes.
 */
export function createProjectsMock(clips: ClipAccess, now: () => number): { routes: MockRoute[] } {
  const parsed = parseProjectList(projectsJson);
  if (parsed === null) throw new Error('mock fixture projects.json does not parse');
  let projects: Project[] = parsed;
  let nextId = 1;

  const view = (project: Project): Project => {
    const members = clips.get().filter((c) => c.project_ids.includes(project.project_id));
    return {
      ...project,
      clip_count: members.length,
      duration_s: members.reduce((sum, c) => sum + (c.duration_s ?? 0), 0),
      size_bytes: members.reduce((sum, c) => sum + c.size_bytes, 0),
    };
  };

  /** The name rule: trimmed, 1–60 characters, unique per user ignoring case. */
  const badName = (name: unknown, exceptId: string | null): string | null => {
    if (typeof name !== 'string') return 'name is required';
    const clean = name.trim();
    if (clean === '' || clean.length > NAME_MAX) return `name must be 1–${String(NAME_MAX)} characters`;
    const taken = projects.some((p) => p.project_id !== exceptId && p.name.toLowerCase() === clean.toLowerCase());
    return taken ? 'You already have a project with this name' : null;
  };

  const addClips = (projectId: string, ids: unknown): MockReply | null => {
    if (ids === undefined) return null;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return fail(400, 'VALIDATION_FAILED', 'clip_ids must be strings');
    const known = new Set(clips.get().map((c) => c.clip_id));
    if (!ids.every((id) => known.has(id))) return fail(404, 'NOT_FOUND', 'No such clip');
    clips.set(clips.get().map((c) =>
      ids.includes(c.clip_id) && !c.project_ids.includes(projectId) ? { ...c, project_ids: [...c.project_ids, projectId] } : c,
    ));
    return null;
  };

  const find = (id: string) => projects.find((p) => p.project_id === id);

  const routes: MockRoute[] = [
    ['GET', /^\/projects$/, () => json(projects.map(view), 200)],
    ['POST', /^\/projects$/, (_m, req) => {
      const body = (req.body ?? {}) as { name?: unknown; color?: unknown; clip_ids?: unknown };
      const nameError = badName(body.name, null);
      if (nameError !== null) return fail(400, 'VALIDATION_FAILED', nameError);
      if (!isColor(body.color)) return fail(400, 'VALIDATION_FAILED', 'Unknown colour');
      const project: Project = {
        project_id: `prj_new_${String(nextId)}`,
        name: String(body.name).trim(),
        color: body.color,
        clip_count: 0,
        duration_s: 0,
        size_bytes: 0,
        created_at: new Date(now()).toISOString(),
      };
      nextId += 1;
      const failed = addClips(project.project_id, body.clip_ids);
      if (failed !== null) return failed;
      projects = [project, ...projects];
      return json(view(project), 300);
    }],
    ['PATCH', /^\/projects\/([^/]+)$/, (m, req) => {
      const project = find(decodeURIComponent(m[1] ?? ''));
      if (project === undefined) return fail(404, 'NOT_FOUND', 'No such project');
      const body = (req.body ?? {}) as { name?: unknown; color?: unknown };
      if (body.name !== undefined) {
        const nameError = badName(body.name, project.project_id);
        if (nameError !== null || typeof body.name !== 'string') return fail(400, 'VALIDATION_FAILED', nameError ?? 'name is required');
        project.name = body.name.trim();
      }
      if (body.color !== undefined) {
        if (!isColor(body.color)) return fail(400, 'VALIDATION_FAILED', 'Unknown colour');
        project.color = body.color;
      }
      return json(view(project), 250);
    }],
    ['DELETE', /^\/projects\/([^/]+)$/, (m) => {
      const id = decodeURIComponent(m[1] ?? '');
      if (find(id) === undefined) return fail(404, 'NOT_FOUND', 'No such project');
      projects = projects.filter((p) => p.project_id !== id);
      clips.set(clips.get().map((c) => ({ ...c, project_ids: c.project_ids.filter((p) => p !== id) })));
      return { kind: 'empty', status: 204 };
    }],
    ['POST', /^\/projects\/([^/]+)\/clips$/, (m, req) => {
      const project = find(decodeURIComponent(m[1] ?? ''));
      if (project === undefined) return fail(404, 'NOT_FOUND', 'No such project');
      const ids = ((req.body ?? {}) as { clip_ids?: unknown }).clip_ids;
      const failed = addClips(project.project_id, ids ?? null);
      return failed ?? json(view(project), 250);
    }],
    ['DELETE', /^\/projects\/([^/]+)\/clips\/([^/]+)$/, (m) => {
      const project = find(decodeURIComponent(m[1] ?? ''));
      if (project === undefined) return fail(404, 'NOT_FOUND', 'No such project');
      const clipId = decodeURIComponent(m[2] ?? '');
      clips.set(clips.get().map((c) => (c.clip_id === clipId ? { ...c, project_ids: c.project_ids.filter((p) => p !== project.project_id) } : c)));
      return { kind: 'empty', status: 204 };
    }],
  ];
  return { routes };
}
