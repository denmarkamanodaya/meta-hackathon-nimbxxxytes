import { describe, expect, it } from 'vitest';
import type { IntentAnswer } from '../../services/api/types';
import { ASK_JOBS_MAX, askReducer, barView, doneLine, jobState, listJobs, pillLabel, rowViews, shownJob, type AskJob } from './jobs';
import { planRows, type PlanContext } from './plan';

const ctx: PlanContext = { projectName: (id) => (id === 'prj_1' ? 'Thai Trip' : null), projectClipCount: () => 4 };

const shortIntent: IntentAnswer = {
  kind: 'make_short',
  title: 'Thai trip sunsets',
  query: 'sunsets',
  source: 'search',
  project_id: null,
  new_project_name: null,
  clip_ids: [],
  target_s: 30,
  aspect: '4:5',
  choices: [],
};

const plan = (jobs: AskJob[], id: string, intent: IntentAnswer = shortIntent) =>
  askReducer(jobs, { type: 'planned', id, text: `ask ${id}`, addedClipIds: [], intent });

const job = (jobs: AskJob[], id: string): AskJob => {
  const found = jobs.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no job ${id}`);
  return found;
};

describe('Ask jobs', () => {
  it('walks plan → running → done, ticking rows forward only', () => {
    let jobs = plan([], 'a');
    jobs = askReducer(jobs, { type: 'started', id: 'a', at: 1000 });
    jobs = askReducer(jobs, { type: 'progressed', id: 'a', patch: { rowsDone: 2, found: 12 } });
    jobs = askReducer(jobs, { type: 'progressed', id: 'a', patch: { rowsDone: 1 } });
    expect(job(jobs, 'a')).toMatchObject({ status: 'running', rowsDone: 2, found: 12, startedAt: 1000 });

    jobs = askReducer(jobs, { type: 'finished', id: 'a', at: 55_000 });
    expect(job(jobs, 'a')).toMatchObject({ status: 'done', rowsDone: 4, endedAt: 55_000 });
  });

  it('ignores progress on a plan and a second finish', () => {
    let jobs = plan([], 'a');
    jobs = askReducer(jobs, { type: 'progressed', id: 'a', patch: { rowsDone: 3 } });
    expect(job(jobs, 'a').rowsDone).toBe(0);

    jobs = askReducer(jobs, { type: 'started', id: 'a', at: 0 });
    jobs = askReducer(jobs, { type: 'failed', id: 'a', at: 5, error: 'No moments found' });
    jobs = askReducer(jobs, { type: 'finished', id: 'a', at: 9 });
    expect(job(jobs, 'a')).toMatchObject({ status: 'failed', error: 'No moments found', endedAt: 5 });
  });

  it('keeps at most ASK_JOBS_MAX, dropping the oldest finished ones but never a running one', () => {
    let jobs = plan([], 'run');
    jobs = askReducer(jobs, { type: 'started', id: 'run', at: 0 });
    for (let i = 0; i < ASK_JOBS_MAX + 2; i += 1) {
      jobs = plan(jobs, `d${String(i)}`);
      jobs = askReducer(jobs, { type: 'started', id: `d${String(i)}`, at: 0 });
      jobs = askReducer(jobs, { type: 'finished', id: `d${String(i)}`, at: 1 });
    }

    expect(jobs).toHaveLength(ASK_JOBS_MAX);
    expect(jobs.some((each) => each.id === 'run')).toBe(true);
    expect(jobs.some((each) => each.id === 'd0')).toBe(false);
  });

  it('shows the pill from two running jobs, and lists running jobs first', () => {
    let jobs = plan([], 'a');
    jobs = askReducer(jobs, { type: 'started', id: 'a', at: 0 });
    expect(pillLabel(jobs)).toBeNull();

    jobs = plan(jobs, 'b');
    jobs = askReducer(jobs, { type: 'started', id: 'b', at: 0 });
    jobs = plan(jobs, 'c');
    expect(pillLabel(jobs)).toBe('2 working');
    expect(listJobs(jobs).map((each) => each.id)).toEqual(['b', 'a', 'c']);
  });

  it('shows the opened job, else the newest plan, else the newest running, else the newest finished', () => {
    let jobs = plan([], 'a');
    jobs = askReducer(jobs, { type: 'started', id: 'a', at: 0 });
    jobs = plan(jobs, 'b');

    expect(shownJob(jobs, null)?.id).toBe('b');
    expect(shownJob(jobs, 'a')?.id).toBe('a');
    expect(shownJob(askReducer(jobs, { type: 'removed', id: 'b' }), null)?.id).toBe('a');
    expect(shownJob([], null)).toBeNull();
  });

  it('draws the rows, bar and lines of a running and a finished short', () => {
    let jobs = plan([], 'a');
    expect(rowViews(job(jobs, 'a'), ctx).map((row) => row.state)).toEqual(['next', 'next', 'next', 'next']);

    jobs = askReducer(jobs, { type: 'started', id: 'a', at: 0 });
    jobs = askReducer(jobs, { type: 'progressed', id: 'a', patch: { rowsDone: 1, found: 12 } });
    const running = job(jobs, 'a');
    const rows = rowViews(running, ctx);
    expect(rows.map((row) => row.state)).toEqual(['done', 'now', 'next', 'next']);
    expect(rows[0]?.detail).toBe('Found 12 moments, best first');
    expect(barView(running, planRows(running.intent, ctx))).toEqual({ percent: 38, label: 'Step 2 of 4 · Plan the cut', right: '38%' });
    expect(jobState(running)).toBe('Step 2 of 4');

    jobs = askReducer(jobs, { type: 'progressed', id: 'a', patch: { score: 41 } });
    jobs = askReducer(jobs, { type: 'finished', id: 'a', at: 54_000 });
    const done = job(jobs, 'a');
    expect(barView(done, planRows(done.intent, ctx))).toEqual({ percent: 100, label: 'All 4 steps done', right: '0:54' });
    expect(rowViews(done, ctx)[3]?.detail).toBe('Score 8/10');
    expect(doneLine(done, ctx)).toBe('Your short is ready: 4:5, about 30 s, editor score 8/10.');
  });

  it('says where clips were added', () => {
    const intent: IntentAnswer = { ...shortIntent, kind: 'add_to_project', source: null, query: null, clip_ids: ['x', 'y'], project_id: 'prj_1' };
    let jobs = plan([], 'p', intent);
    jobs = askReducer(jobs, { type: 'started', id: 'p', at: 0 });
    jobs = askReducer(jobs, { type: 'finished', id: 'p', at: 1 });

    expect(doneLine(job(jobs, 'p'), ctx)).toBe('2 clips added to Thai Trip.');
  });
});
