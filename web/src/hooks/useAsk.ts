// The Ask box's jobs: send a request to Muse Spark, keep what it read as a plan, run a plan with
// the existing calls (a short from the added clips, a project or a search; a guide from one clip;
// an upload; clips into a project) and follow each run to its end. The Mac shell provides one
// queue for every screen; `useShortJob` and `useGuideJob` tick a running job from the short's
// status and agent steps or the guide's stage.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { askReducer, type AskAction, type AskJob } from '../core/ask/jobs';
import { guideRowsDone, shortRowsDone } from '../core/ask/progress';
import { nextProjectColor } from '../core/projects';
import { itemPath, type SearchScope } from '../core/search-bar';
import { shortPool, SHORT_POOL_MAX } from '../core/short-pool';
import type { IntentAnswer } from '../services/api/types';
import { useServices } from './services-context';
import { useCreateShort, useShort } from './useEditor';
import { usePickAndUpload } from './useDesktop';
import { useGuide } from './useGuides';
import { useProjectActions, useProjects } from './useProjects';
import { useRecentQueries } from './useSearch';

/** What a send became: a search that opened the results, a card above the box, or nothing. */
export type AskSent = 'search' | 'card' | 'failed';

/** The queue and its actions. */
export interface AskQueue {
  /** Newest first. */
  jobs: AskJob[];
  /** The job opened from the pill's list, if any. */
  openId: string | null;
  /** True while Muse Spark reads a request. */
  isReading: boolean;
  /** Reads a request; a search opens its results, anything else waits as a card. */
  send: (text: string, clipIds: readonly string[], scope: SearchScope) => Promise<AskSent>;
  /** Runs a plan. */
  run: (jobId: string) => void;
  /** Drops a plan or a finished job. */
  dismiss: (jobId: string) => void;
  /** Stops a running job and deletes what it made so far ("Stop keeps nothing"). */
  stop: (jobId: string) => void;
  /** Opens a job's card from the list; null goes back to the default card. */
  open: (jobId: string | null) => void;
  /** For the watchers: a running job moved on, ended or failed. */
  report: (action: Extract<AskAction, { type: 'progressed' | 'finished' | 'failed' }>) => void;
}

/** Provided by the Mac shell. */
export const AskContext = createContext<AskQueue | null>(null);

/**
 * The shell's queue.
 * @returns The queue.
 * @throws Error outside the Mac shell (a wiring bug).
 */
export function useAsk(): AskQueue {
  const queue = useContext(AskContext);
  if (queue === null) throw new Error('useAsk called outside the Ask provider');
  return queue;
}

/** Why a short could not start, as the card says it. */
export const NO_MOMENTS = 'No moments found for this short. Try other words, or add clips with +';

const message = (error: unknown, fallback: string): string => (error instanceof Error && error.message !== '' ? error.message : fallback);

/**
 * The queue's state and actions, for the provider.
 * @returns The queue.
 */
export function useAskQueue(): AskQueue {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const { record } = useRecentQueries();
  const { create: createShort } = useCreateShort();
  const { pick } = usePickAndUpload();
  const { create: createProject, addClips } = useProjectActions();
  const { state: projectsState } = useProjects();
  const projects = projectsState.status === 'ready' ? projectsState.data : null;
  const [jobs, dispatch] = useReducer(askReducer, []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [isReading, setReading] = useState(false);
  const jobsRef = useRef<AskJob[]>(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const nextId = useRef(1);

  const isLive = useCallback((jobId: string) => jobsRef.current.some((job) => job.id === jobId && job.status === 'running'), []);

  const send = useCallback(
    async (text: string, clipIds: readonly string[], scope: SearchScope): Promise<AskSent> => {
      setReading(true);
      let intent: IntentAnswer;
      try {
        intent = await api.readIntent({ text, clip_ids: [...clipIds] });
      } catch (error) {
        toasts.error('Could not read your request', error);
        return 'failed';
      } finally {
        setReading(false);
      }
      if (intent.kind === 'search') {
        const query = intent.query ?? text;
        record(query);
        void navigate(itemPath({ kind: 'all' }, query, scope));
        return 'search';
      }
      const id = `ask-${String(nextId.current)}`;
      nextId.current += 1;
      dispatch({ type: 'planned', id, text, addedClipIds: [...clipIds], intent });
      setOpenId(null);
      return 'card';
    },
    [api, toasts, record, navigate],
  );

  /**
   * The moments a short starts from: a search; a project (its clips' best moments, or with a
   * query the search's moments in that project, best first, falling back to the whole project
   * when none match); or the added clips.
   */
  const gather = useCallback(
    async (intent: IntentAnswer): Promise<string[]> => {
      if (intent.source === 'search') {
        const found = await api.search(intent.query ?? '');
        return found.results.slice(0, SHORT_POOL_MAX).map((result) => result.segment_id);
      }
      let ids = intent.clip_ids;
      if (intent.source === 'project' && intent.project_id !== null) {
        const clips = (await api.listProjectClips(intent.project_id)).filter((clip) => clip.status === 'ready' && clip.segment_count > 0);
        ids = clips.map((clip) => clip.clip_id);
        if (intent.query !== null && intent.query.trim() !== '') {
          const inProject = new Set(ids);
          const found = await api.search(intent.query);
          const hits = found.results.filter((result) => inProject.has(result.clip_id)).slice(0, SHORT_POOL_MAX);
          if (hits.length > 0) return hits.map((result) => result.segment_id);
        }
      }
      const details = await Promise.all(ids.map((id) => api.getClip(id)));
      return shortPool(details).segmentIds;
    },
    [api],
  );

  const runShort = useCallback(
    async (job: AskJob) => {
      const { intent } = job;
      const segmentIds = await gather(intent);
      if (!isLive(job.id)) return;
      if (segmentIds.length === 0) {
        dispatch({ type: 'failed', id: job.id, at: Date.now(), error: NO_MOMENTS });
        return;
      }
      const shortId = await createShort({ segment_ids: segmentIds, prompt: job.text, target_s: intent.target_s ?? 30, aspect: intent.aspect ?? '4:5' });
      if (shortId === null) {
        dispatch({ type: 'failed', id: job.id, at: Date.now(), error: 'Could not start the editor' });
        return;
      }
      // Stopped while it started: keep nothing.
      if (!isLive(job.id)) {
        void api.deleteShort(shortId).catch(() => undefined);
        return;
      }
      dispatch({ type: 'progressed', id: job.id, patch: { shortId, found: segmentIds.length, rowsDone: 1 } });
    },
    [api, gather, createShort, isLive],
  );

  const runGuide = useCallback(
    async (job: AskJob) => {
      const clipId = job.intent.clip_ids[0];
      if (clipId === undefined) throw new Error('Add the task video with +');
      const { guide_id: guideId } = await api.startGuide(clipId);
      if (!isLive(job.id)) {
        void api.deleteGuide(guideId).catch(() => undefined);
        return;
      }
      dispatch({ type: 'progressed', id: job.id, patch: { guideId } });
    },
    [api, isLive],
  );

  const runUpload = useCallback(
    async (job: AskJob) => {
      const count = await pick();
      if (count === 0) {
        dispatch({ type: 'removed', id: job.id });
        return;
      }
      dispatch({ type: 'progressed', id: job.id, patch: { found: count, rowsDone: 2 } });
      dispatch({ type: 'finished', id: job.id, at: Date.now() });
    },
    [pick],
  );

  const runAddToProject = useCallback(
    async (job: AskJob) => {
      const { intent } = job;
      let projectId = intent.project_id;
      if (projectId === null) {
        const made = await createProject({ name: intent.new_project_name ?? job.intent.title, color: nextProjectColor(projects ?? []) });
        if (made === null) throw new Error('Could not make the project');
        projectId = made.project_id;
        dispatch({ type: 'progressed', id: job.id, patch: { projectId, rowsDone: 1 } });
      }
      if (!(await addClips(projectId, intent.clip_ids))) throw new Error('Could not add to the project');
      dispatch({ type: 'progressed', id: job.id, patch: { projectId } });
      dispatch({ type: 'finished', id: job.id, at: Date.now() });
    },
    [createProject, addClips, projects],
  );

  const run = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((each) => each.id === jobId && each.status === 'plan');
      if (job === undefined) return;
      dispatch({ type: 'started', id: jobId, at: Date.now() });
      // The reducer has the job running; the ref follows on the next render, so mark it here too.
      jobsRef.current = askReducer(jobsRef.current, { type: 'started', id: jobId, at: Date.now() });
      setOpenId(null);
      const runs: Partial<Record<IntentAnswer['kind'], (job: AskJob) => Promise<void>>> = {
        make_short: runShort,
        make_guide: runGuide,
        upload: runUpload,
        add_to_project: runAddToProject,
      };
      const go = runs[job.intent.kind];
      if (go === undefined) return;
      go(job).catch((error: unknown) => {
        dispatch({ type: 'failed', id: jobId, at: Date.now(), error: message(error, 'Something went wrong') });
      });
    },
    [runShort, runGuide, runUpload, runAddToProject],
  );

  const dismiss = useCallback((jobId: string) => {
    dispatch({ type: 'removed', id: jobId });
    setOpenId((current) => (current === jobId ? null : current));
  }, []);

  const stop = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((each) => each.id === jobId);
      if (job === undefined) return;
      if (job.shortId !== null) {
        api.deleteShort(job.shortId).catch((error: unknown) => {
          toasts.error('Could not delete the short', error);
        });
      }
      if (job.guideId !== null) {
        api.deleteGuide(job.guideId).catch((error: unknown) => {
          toasts.error('Could not delete the guide', error);
        });
      }
      dismiss(jobId);
    },
    [api, toasts, dismiss],
  );

  const report = useCallback<AskQueue['report']>((action) => {
    dispatch(action);
  }, []);

  return useMemo(
    () => ({ jobs, openId, isReading, send, run, dismiss, stop, open: setOpenId, report }),
    [jobs, openId, isReading, send, run, dismiss, stop, report],
  );
}

/**
 * Ticks a running short job from its status and agent steps; ends it at Ready or failed.
 * @param job - The job (with its short id).
 * @param shortId - The short.
 * @param report - The queue's `report`.
 */
export function useShortJob(job: AskJob, shortId: string, report: AskQueue['report']): void {
  const { state, steps } = useShort(shortId);
  const status = state.status === 'ready' ? state.data.short.status : null;
  const best = state.status === 'ready' ? state.data.versions.find((version) => version.n === state.data.short.best_version) : undefined;
  const score = best?.score_total ?? null;
  const rowsDone = shortRowsDone(status, steps);
  const { id } = job;
  useEffect(() => {
    if (status === null) return;
    report({ type: 'progressed', id, patch: { rowsDone, ...(score === null ? {} : { score }) } });
    if (status === 'ready') report({ type: 'finished', id, at: Date.now() });
    if (status === 'failed') report({ type: 'failed', id, at: Date.now(), error: 'The editor stopped before the short was ready' });
  }, [id, status, rowsDone, score, report]);
}

/**
 * Ticks a running guide job from its stage; ends it at Ready, failed or refused.
 * @param job - The job (with its guide id).
 * @param guideId - The guide.
 * @param report - The queue's `report`.
 */
export function useGuideJob(job: AskJob, guideId: string, report: AskQueue['report']): void {
  const { state } = useGuide(guideId);
  const guide = state.status === 'ready' ? state.data : null;
  const status = guide?.status ?? null;
  const stage = guide?.stage ?? null;
  const error = guide?.error ?? null;
  const { id } = job;
  useEffect(() => {
    if (status === null) return;
    report({ type: 'progressed', id, patch: { rowsDone: guideRowsDone(status, stage) } });
    if (status === 'ready') report({ type: 'finished', id, at: Date.now() });
    if (status === 'failed') report({ type: 'failed', id, at: Date.now(), error: error ?? 'The guide stopped before it was ready' });
    if (status === 'refused') report({ type: 'failed', id, at: Date.now(), error: error ?? 'nimbytes does not make a guide for this task' });
  }, [id, status, stage, error, report]);
}
