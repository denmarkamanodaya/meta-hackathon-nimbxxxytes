// Mock iListen recordings for `npm run dev:mock` and `dev:desktop-mock`: the spike samples from
// listens.json (the zh/ja meeting fixed in v2, the Mandarin birthday plans, the Kyoto briefing, an
// English warehouse notice in 中文 that needs a human check, and a concert clip parked at Check v1).
// A new recording (once its source is PUT), a clip and a language change (even mid-job: it starts
// again at understand) walk audio → transcribe → understand → check v1
// (fails at 82%) → check v2 → voice → ready on the clock. The same rules the API enforces: audio or
// video, 300 MB, a listed output language, a title of 1–80 characters.
import { isOutputLanguage } from '../../core/ilisten/languages';
import { LISTEN_MAX_BYTES, listenType, MAX_LISTEN_TITLE_CHARS } from '../../core/ilisten/listens';
import { parseListen } from '../../services/api/parse-listens';
import type { ListenDetail, ListenStep, ListenSummary, ListenVersion } from '../../services/api/types';
import listensJson from '../fixtures/listens.json';
import { fail, json, type MockRoute } from './reply';

/** One phase of a mock listen job and how long it takes, ms. */
interface Phase {
  step: ListenStep;
  version: number;
  ms: number;
}

/** The job, phase by phase: v1 fails its check, one fix pass, v2 passes. */
export const PHASES: readonly Phase[] = [
  { step: 'audio', version: 1, ms: 1500 },
  { step: 'transcribe', version: 1, ms: 2500 },
  { step: 'understand', version: 1, ms: 2500 },
  { step: 'check', version: 1, ms: 2500 },
  { step: 'check', version: 2, ms: 2500 },
  { step: 'voice', version: 2, ms: 1500 },
];

/** Where a language change starts (understand; the transcript stays). */
const UNDERSTAND_PHASE = 2;

/** How long the whole job takes, ms. */
export const LISTEN_JOB_MS = PHASES.reduce((sum, phase) => sum + phase.ms, 0);

const V1_FAILED: ListenVersion = { version: 1, confidence: 82, summary_score: 88, passed: false, notes: ['Line 2: an amount was left out'] };
const V2_PASSED: ListenVersion = { version: 2, confidence: 97, summary_score: 97, passed: true, notes: ['Line 2 fixed. Passed.'] };

/** A recording at work: the finished listen it becomes, and when its job started (and from which phase). */
interface MockListen {
  listen: ListenDetail;
  job: { startedAt: number; fromPhase: number; result: ListenDetail } | null;
}

function samples(): MockListen[] {
  return listensJson.map((raw) => {
    const listen = parseListen(raw);
    if (listen === null) throw new Error(`mock fixture listens.json ${raw.id} does not parse`);
    return { listen, job: null };
  });
}

const sample = (id: string): ListenDetail => {
  const found = samples().find((entry) => entry.listen.id === id);
  if (found === undefined) throw new Error(`mock fixture listens.json has no ${id}`);
  return found.listen;
};

const summaryOf = (listen: ListenDetail): ListenSummary => {
  const { id, title, source_name, source_kind, clip_id, status, step, version, target, languages, duration_ms, speakers, confidence, passed, created_at, error } = listen;
  return { id, title, source_name, source_kind, clip_id, status, step, version, target, languages, duration_ms, speakers, confidence, passed, created_at, error };
};

/**
 * The listen as it stands `elapsed` ms into its job.
 * @param result - What it becomes.
 * @param fromPhase - The phase the job started at.
 * @param elapsed - Time since the start, ms.
 * @returns The listen, listening or ready.
 */
export function atTime(result: ListenDetail, fromPhase: number, elapsed: number): ListenDetail {
  let left = elapsed;
  for (let index = fromPhase; index < PHASES.length; index += 1) {
    const phase = PHASES[index];
    if (phase === undefined) break;
    if (left < phase.ms) {
      const heard = index > UNDERSTAND_PHASE;
      const transcribed = index > 1;
      return {
        ...result,
        status: 'listening',
        step: phase.step,
        version: phase.version,
        title: heard ? result.title : '',
        languages: heard ? result.languages : [],
        speakers: transcribed ? result.speakers : 0,
        duration_ms: index > 0 ? result.duration_ms : null,
        confidence: null,
        passed: false,
        summary: '',
        key_points: [],
        turns: transcribed ? result.turns.map((turn) => ({ ...turn, translation: '', score: null, issue: '', fixed_in: 1 })) : [],
        versions: phase.step !== 'check' && phase.step !== 'voice' ? [] : phase.version === 1 ? [{ ...V1_FAILED, confidence: null, summary_score: null, notes: [] }] : phase.step === 'check' ? [V1_FAILED, { ...V2_PASSED, confidence: null, summary_score: null, passed: false, notes: [] }] : [V1_FAILED, V2_PASSED],
        summary_audio_url: null,
      };
    }
    left -= phase.ms;
  }
  return result;
}

/**
 * Builds the listen routes.
 * @param now - Clock in ms.
 * @returns The routes.
 */
export function createListensMock(now: () => number): { routes: MockRoute[] } {
  let entries: MockListen[] = samples();
  let nextId = 1;

  const view = (entry: MockListen): ListenDetail => {
    if (entry.job === null) return entry.listen;
    const shown = atTime(entry.job.result, entry.job.fromPhase, now() - entry.job.startedAt);
    if (shown.status === 'ready') entry.job = null;
    entry.listen = shown;
    return shown;
  };
  const find = (id: string) => entries.find((entry) => entry.listen.id === decodeURIComponent(id));
  const startJob = (entry: MockListen, result: ListenDetail, fromPhase: number) => {
    entry.job = { startedAt: now(), fromPhase, result: { ...result, id: entry.listen.id, created_at: entry.listen.created_at } };
    view(entry);
  };
  /** What a new file or clip comes out as: the birthday plans (a fixed line on v2) in the asked language. */
  const resultFor = (name: string, kind: 'file' | 'clip', clipId: string | null, target: string): ListenDetail => {
    const birthday = sample('lis_birthday');
    return {
      ...birthday,
      source_name: name,
      source_kind: kind,
      clip_id: clipId,
      status: 'ready',
      step: null,
      target,
      version: 2,
      confidence: V2_PASSED.confidence,
      passed: true,
      turns: birthday.turns.map((turn) => ({ ...turn, score: 97, issue: '', fixed_in: 2 })),
      versions: [V1_FAILED, V2_PASSED],
    };
  };

  const routes: MockRoute[] = [
    ['GET', /^\/listens$/, () => json(entries.map((entry) => summaryOf(view(entry))), 250)],
    ['POST', /^\/listens$/, (_m, req) => {
      const body = (req.body ?? {}) as { filename?: unknown; content_type?: unknown; size_bytes?: unknown; clip_id?: unknown; target?: unknown };
      if (typeof body.target !== 'string' || !isOutputLanguage(body.target)) return fail(400, 'VALIDATION_FAILED', 'target must be an output language');
      const id = `lis_new_${String(nextId)}`;
      nextId += 1;
      const isClip = typeof body.clip_id === 'string';
      if (!isClip) {
        const name = typeof body.filename === 'string' ? body.filename : '';
        const type = typeof body.content_type === 'string' ? listenType(name, body.content_type) : null;
        if (type === null) return fail(400, 'VALIDATION_FAILED', 'content_type must be audio or video');
        if (typeof body.size_bytes !== 'number' || body.size_bytes <= 0 || body.size_bytes > LISTEN_MAX_BYTES) {
          return fail(400, 'VALIDATION_FAILED', 'size_bytes must be 1 byte to 300 MB');
        }
      }
      const name = isClip ? 'Clip from your library' : String(body.filename);
      const clipId = isClip ? String(body.clip_id) : null;
      const listen: ListenDetail = {
        ...atTime(resultFor(name, isClip ? 'clip' : 'file', clipId, body.target), 0, 0),
        id,
        status: isClip ? 'listening' : 'uploading',
        step: isClip ? 'audio' : null,
        created_at: new Date(now()).toISOString(),
      };
      const entry: MockListen = { listen, job: null };
      entries = [entry, ...entries];
      if (isClip) startJob(entry, resultFor(name, 'clip', clipId, body.target), 0);
      return json({ listen_id: id, status: entry.listen.status }, 300, 201);
    }],
    // The file itself (the mock is not sent its bytes): it queues the job, as the API does. Complete
    // does the same and is idempotent once the job runs.
    ...(['PUT', 'POST'] as const).map((method): MockRoute => [
      method,
      method === 'PUT' ? /^\/listens\/([^/]+)\/source$/ : /^\/listens\/([^/]+)\/complete$/,
      (m) => {
        const entry = find(m[1] ?? '');
        if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such recording');
        if (entry.listen.status === 'uploading') {
          startJob(entry, resultFor(entry.listen.source_name, 'file', null, entry.listen.target), 0);
        }
        return json({ listen_id: entry.listen.id, status: view(entry).status }, method === 'PUT' ? 400 : 200, 202);
      },
    ]),
    ['GET', /^\/listens\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      return entry === undefined ? fail(404, 'NOT_FOUND', 'No such recording') : json(view(entry), 250);
    }],
    ['PATCH', /^\/listens\/([^/]+)$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such recording');
      const raw = ((req.body ?? {}) as { title?: unknown }).title;
      const title = typeof raw === 'string' ? raw.trim() : '';
      if (title === '' || Array.from(title).length > MAX_LISTEN_TITLE_CHARS) {
        return fail(400, 'VALIDATION_FAILED', `title must be 1–${String(MAX_LISTEN_TITLE_CHARS)} characters`);
      }
      entry.listen = { ...view(entry), title };
      return json(entry.listen, 200);
    }],
    ['DELETE', /^\/listens\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such recording');
      entries = entries.filter((each) => each !== entry);
      return { kind: 'empty', status: 204 };
    }],
    ['POST', /^\/listens\/([^/]+)\/language$/, (m, req) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such recording');
      const target = ((req.body ?? {}) as { target?: unknown }).target;
      if (typeof target !== 'string' || !isOutputLanguage(target)) return fail(400, 'VALIDATION_FAILED', 'target must be an output language');
      // Busy or not, the job starts again at understand with the new language (the transcript stays).
      const base = entry.job?.result ?? view(entry);
      startJob(entry, { ...base, target }, UNDERSTAND_PHASE);
      return json(entry.listen, 200);
    }],
  ];
  return { routes };
}
