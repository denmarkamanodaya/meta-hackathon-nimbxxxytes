// Projects data for the Mac Gallery and the project page: the polled list, one project's clips,
// and the writes (create, rename, recolour, delete, add or remove clips). Every list on screen
// (sidebar, menus, page) reloads at once after a write: writes announce themselves on one
// in-module channel the list hooks listen to. Failures raise a toast and resolve null or false.
import { useCallback, useEffect, useState } from 'react';
import { allInProject, shortsUsingClips } from '../core/projects';
import type { ClipSummary, CreateProjectRequest, Project, UpdateProjectRequest } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Projects list poll interval, ms (another window may change it). */
export const PROJECTS_POLL_MS = 30_000;

/** Project clips poll interval, ms (clips move through processing). */
export const PROJECT_CLIPS_POLL_MS = 5000;

const changes = new EventTarget();
const CHANGED = 'projects-changed';

/** Tells every mounted project list to reload. */
const announce = () => {
  changes.dispatchEvent(new Event(CHANGED));
};

/** Reloads whenever a write announces itself. */
function useReloadOnChange(refresh: () => void) {
  useEffect(() => {
    changes.addEventListener(CHANGED, refresh);
    return () => {
      changes.removeEventListener(CHANGED, refresh);
    };
  }, [refresh]);
}

/**
 * Every project, newest first.
 * @returns The polled list and `refresh`.
 */
export function useProjects(): { state: Polled<Project[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listProjects(signal), [api]);
  const polled = usePolled(load, { intervalMs: PROJECTS_POLL_MS });
  useReloadOnChange(polled.refresh);
  return polled;
}

/**
 * The clips in one project.
 * @param projectId - The project.
 * @returns The polled clips and `refresh`.
 */
export function useProjectClips(projectId: string): { state: Polled<ClipSummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listProjectClips(projectId, signal), [api, projectId]);
  const polled = usePolled(load, { intervalMs: PROJECT_CLIPS_POLL_MS });
  useReloadOnChange(polled.refresh);
  return polled;
}

/**
 * "Shorts made" for some clips: loads the shorts list, then each short's moments (the list rows do
 * not say which clips a short uses), and counts the shorts cut from any of the clips.
 * @param clipIds - The project's clips.
 * @returns The count, or null while it loads (or when the shorts cannot be read).
 */
export function useShortsMade(clipIds: readonly string[]): number | null {
  const { api } = useServices();
  const key = clipIds.join(' ');
  const [made, setMade] = useState<{ key: string; count: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const ids = key === '' ? [] : key.split(' ');
    api
      .listShorts(controller.signal)
      .then((rows) => Promise.allSettled(rows.map((row) => api.getShort(row.short_id, controller.signal))))
      .then((answers) => {
        const shorts = answers.flatMap((answer) => (answer.status === 'fulfilled' ? [answer.value] : []));
        setMade({ key, count: shortsUsingClips(shorts, ids) });
      })
      .catch(() => {
        // Recovers: "Shorts made" shows a dash when the shorts cannot be read.
      });
    return () => {
      controller.abort();
    };
  }, [api, key]);
  return made?.key === key ? made.count : null;
}

/** Poll interval while a project's key art is being drawn, ms. */
export const PROJECT_ART_POLL_MS = 3000;

/**
 * A project's New art: starts the drawing, then reloads the project lists every few seconds
 * while the art is being drawn, so the banner turns over as soon as it lands.
 * @param project - The project shown.
 * @returns `newArt`, resolving true when the drawing started (a failure raises a toast).
 */
export function useProjectArt(project: Pick<Project, 'project_id' | 'art_drawing'>): { newArt: () => Promise<boolean> } {
  const { api, toasts } = useServices();
  const { project_id: projectId, art_drawing: isDrawing } = project;
  useEffect(() => {
    if (!isDrawing) return undefined;
    const timer = setInterval(announce, PROJECT_ART_POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [isDrawing]);
  const newArt = useCallback(async () => {
    try {
      await api.newProjectArt(projectId);
      announce();
      return true;
    } catch (error) {
      toasts.error('Could not draw new art', error);
      return false;
    }
  }, [api, projectId, toasts]);
  return { newArt };
}

/**
 * Reloads a list (for example the Gallery's clips) after any project write.
 * @param refresh - The list's reload; must be stable.
 */
export const useOnProjectsChanged = useReloadOnChange;

/** The project writes. */
export interface ProjectActions {
  create: (request: CreateProjectRequest) => Promise<Project | null>;
  update: (projectId: string, update: UpdateProjectRequest) => Promise<Project | null>;
  remove: (projectId: string) => Promise<boolean>;
  addClips: (projectId: string, clipIds: string[]) => Promise<boolean>;
  removeClip: (projectId: string, clipId: string) => Promise<boolean>;
  /**
   * The Add to project submenu's check item: takes the clips out when all are in the project,
   * else puts every one of them in.
   */
  toggle: (projectId: string, clips: readonly ClipSummary[]) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * The writes, each reloading every project list on success.
 * @returns The actions.
 */
export function useProjectActions(): ProjectActions {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);

  const run = useCallback(
    async <T,>(title: string, call: () => Promise<T>): Promise<T | null> => {
      setSaving(true);
      try {
        const answer = await call();
        announce();
        return answer;
      } catch (error) {
        toasts.error(title, error);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [toasts],
  );

  const create = useCallback((request: CreateProjectRequest) => run('Could not make the project', () => api.createProject(request)), [api, run]);
  const update = useCallback(
    (projectId: string, change: UpdateProjectRequest) => run('Could not change the project', () => api.updateProject(projectId, change)),
    [api, run],
  );
  const remove = useCallback(
    async (projectId: string) => (await run('Could not delete the project', () => api.deleteProject(projectId))) !== null,
    [api, run],
  );
  const addClips = useCallback(
    async (projectId: string, clipIds: string[]) =>
      (await run('Could not add to the project', () => api.addProjectClips(projectId, clipIds))) !== null,
    [api, run],
  );
  const removeClip = useCallback(
    async (projectId: string, clipId: string) =>
      (await run('Could not take the clip out', () => api.removeProjectClip(projectId, clipId))) !== null,
    [api, run],
  );
  const toggle = useCallback(
    async (projectId: string, clips: readonly ClipSummary[]) => {
      if (!allInProject(clips, projectId)) return addClips(projectId, clips.map((clip) => clip.clip_id));
      const done = await run('Could not take the clips out', () =>
        Promise.all(clips.map((clip) => api.removeProjectClip(projectId, clip.clip_id))),
      );
      return done !== null;
    },
    [api, run, addClips],
  );
  return { create, update, remove, addClips, removeClip, toggle, isSaving };
}
