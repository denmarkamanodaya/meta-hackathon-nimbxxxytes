// Mock Memory Lane sessions for `npm run dev:mock`: one finished sample (Sam, for Mum, four moments,
// one line fixed by the check), and every new session (from a person or a day, for a viewer) walks
// find → write → check → cover → ready on the clock, with its moments found after find. Moments
// have no video in mock mode (the drawn scene shows as the poster); the line is read aloud as in
// the real app. The same rules the API enforces: exactly one of person_id / clip_id, a viewer that
// is one of the caller's named people, and NOT_FOUND for anything else.
import type { ClipSummary, IntentAnswer, MemoryDetail, MemoryMoment, MemoryStep, MemorySummary, NamedPerson } from '../../services/api/types';
import { fail, json, type MockRoute } from './reply';
import { faceCrop, sceneThumb } from './thumbs';

/** One phase of the mock job and how long it takes, ms. */
export const MEMORY_PHASES: readonly { step: MemoryStep; ms: number }[] = [
  { step: 'find', ms: 2000 },
  { step: 'write', ms: 3000 },
  { step: 'check', ms: 3000 },
  { step: 'cover', ms: 2000 },
];

/** How long the whole job takes, ms. */
export const MEMORY_JOB_MS = MEMORY_PHASES.reduce((sum, phase) => sum + phase.ms, 0);

/** What the mock writes over each moment: a line and a gentle question, by who is in it. */
const LINES: readonly { line: (who: string, you: string | null) => string; prompt: (who: string, you: string | null) => string }[] = [
  {
    line: (who, you) => (you === null ? `${who} pours the coffee by the kitchen window.` : `You and ${who} share the first coffee by the kitchen window.`),
    prompt: (who) => `How did ${who} like the coffee?`,
  },
  { line: (who) => `${who} laughs at something just out of frame on the walk to work.`, prompt: (who) => `What do you think made ${who} laugh?` },
  { line: (who) => `${who} waves from across the street in the morning light.`, prompt: (who) => `Where was ${who} going that morning?` },
  { line: (who, you) => (you === null ? `${who} holds the door and smiles.` : `${who} holds the door open for you and smiles.`), prompt: (who) => `What would you say to ${who} now?` },
];

const momentFor = (index: number, clip: ClipSummary, who: NamedPerson, viewer: NamedPerson | null): MemoryMoment => {
  const words = LINES[index % LINES.length];
  const people = [who, ...(viewer === null || viewer.person_id === who.person_id || index % 2 === 1 ? [] : [viewer])];
  return {
    index,
    clip_id: clip.clip_id,
    clip_title: clip.title,
    recorded_at: clip.recorded_at,
    start_s: 4 + index * 9,
    end_s: 10 + index * 9,
    proxy_url: null,
    thumb_url: sceneThumb(`${clip.clip_id}-m${String(index)}`),
    people: people.map((person) => ({ person_id: person.person_id, name: person.name, crop_url: faceCrop(person.person_id) })),
    line: words === undefined ? '' : words.line(who.name, viewer?.name ?? null),
    prompt: words === undefined ? '' : words.prompt(who.name, viewer?.name ?? null),
    checked: true,
    fixed_note: index === 1 ? `“${viewer?.name ?? 'You'} sits beside ${who.name}” was not in the frame; dropped.` : null,
  };
};

/** A session at work: what it becomes and when its job started; null when done. */
interface MockMemory {
  result: MemoryDetail;
  startedAt: number | null;
}

/**
 * The session as it stands `elapsed` ms into its job.
 * @param result - What it becomes.
 * @param elapsed - Time since the start, ms.
 * @returns The session, making or ready.
 */
export function memoryAt(result: MemoryDetail, elapsed: number): MemoryDetail {
  let left = elapsed;
  for (const [at, phase] of MEMORY_PHASES.entries()) {
    if (left < phase.ms) {
      const found = at > 0;
      const written = at > 1;
      return {
        summary: {
          ...result.summary,
          status: 'making',
          step: phase.step,
          title: written ? result.summary.title : '',
          moment_count: found ? result.summary.moment_count : 0,
          fixed_count: at > 2 ? result.summary.fixed_count : 0,
          cover_url: null,
        },
        moments: found ? result.moments.map((moment) => (written ? moment : { ...moment, line: '', prompt: '', checked: false, fixed_note: null })) : [],
      };
    }
    left -= phase.ms;
  }
  return result;
}

/** The person a request names ("remember Sam", "show Mum her memories of Leo"), or a day by its clip title. */
export function memoryIntent(text: string, people: readonly NamedPerson[], clips: readonly ClipSummary[]): Pick<IntentAnswer, 'title' | 'person_id' | 'clip_id' | 'viewer_id'> | null {
  const lower = text.toLowerCase();
  if (!/\b(remember|memories|memory lane)\b/.test(lower)) return null;
  const named = (name: string) => new RegExp(`\\b${name.toLowerCase()}\\b`).test(lower);
  const viewer = people.find((person) => new RegExp(`\\b(show|for) ${person.name.toLowerCase()}\\b`).test(lower)) ?? null;
  const subject = people.find((person) => named(person.name) && person.person_id !== viewer?.person_id);
  if (subject !== undefined) return { title: `Remember ${subject.name}`, person_id: subject.person_id, clip_id: null, viewer_id: viewer?.person_id ?? null };
  const day = clips.find((clip) => clip.status === 'ready' && lower.includes(clip.title.toLowerCase()));
  return day === undefined ? null : { title: `Memory Lane of ${day.title}`, person_id: null, clip_id: day.clip_id, viewer_id: viewer?.person_id ?? null };
}

/**
 * Builds the Memory Lane routes.
 * @param now - Clock in ms.
 * @param people - The caller's named people as they are now.
 * @param clips - The caller's clips as they are now.
 * @returns The routes.
 */
export function createMemoriesMock(now: () => number, people: () => readonly NamedPerson[], clips: () => readonly ClipSummary[]): { routes: MockRoute[] } {
  let nextId = 1;
  const make = (id: string, who: NamedPerson, viewer: NamedPerson | null, from: readonly ClipSummary[], day: ClipSummary | null): MemoryDetail => {
    const moments = Array.from({ length: 4 }, (_, index) => from[index % from.length]).flatMap((clip, index) => (clip === undefined ? [] : [momentFor(index, clip, who, viewer)]));
    const summary: MemorySummary = {
      id,
      title: day === null ? `${who.name}, ${viewer === null ? 'remembered' : `for ${viewer.name}`}` : day.title,
      subject_kind: day === null ? 'person' : 'clip',
      subject_name: day === null ? who.name : day.title,
      viewer_name: viewer?.name ?? null,
      status: 'ready',
      step: null,
      moment_count: moments.length,
      fixed_count: moments.filter((moment) => moment.fixed_note !== null).length,
      cover_url: sceneThumb(`${id}-cover`),
      created_at: new Date(now()).toISOString(),
      error: null,
    };
    return { summary, moments };
  };
  const ready = () => clips().filter((clip) => clip.status === 'ready');

  const entries: MockMemory[] = [];
  const firstPerson = people()[0];
  const firstViewer = people()[2] ?? null;
  if (firstPerson !== undefined && ready().length > 0) {
    entries.push({ result: make('mem_sample', firstPerson, firstViewer, ready(), null), startedAt: null });
  }

  const view = (entry: MockMemory): MemoryDetail => {
    if (entry.startedAt === null) return entry.result;
    const shown = memoryAt(entry.result, now() - entry.startedAt);
    if (shown.summary.status === 'ready') entry.startedAt = null;
    return shown;
  };
  const find = (id: string) => entries.find((entry) => entry.result.summary.id === decodeURIComponent(id));

  const routes: MockRoute[] = [
    ['GET', /^\/memories$/, () => json(entries.map((entry) => view(entry).summary), 250)],
    ['POST', /^\/memories$/, (_m, req) => {
      const body = (req.body ?? {}) as { person_id?: unknown; clip_id?: unknown; viewer_id?: unknown };
      const personId = typeof body.person_id === 'string' ? body.person_id : null;
      const clipId = typeof body.clip_id === 'string' ? body.clip_id : null;
      if ((personId === null) === (clipId === null)) return fail(400, 'VALIDATION_FAILED', 'exactly one of person_id or clip_id');
      const named = people();
      const viewer = typeof body.viewer_id === 'string' ? named.find((person) => person.person_id === body.viewer_id) : null;
      if (viewer === undefined) return fail(404, 'NOT_FOUND', 'No such person');
      const day = clipId === null ? null : (ready().find((clip) => clip.clip_id === clipId) ?? null);
      const who = personId === null ? (named[0] ?? null) : (named.find((person) => person.person_id === personId) ?? null);
      if (who === null || (clipId !== null && day === null)) return fail(404, 'NOT_FOUND', 'No such person or clip');
      const id = `mem_new_${String(nextId)}`;
      nextId += 1;
      const result = make(id, who, viewer, day === null ? ready() : [day], day);
      entries.unshift({ result, startedAt: now() });
      return json({ memory_id: id, status: 'making' }, 300, 201);
    }],
    ['GET', /^\/memories\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      return entry === undefined ? fail(404, 'NOT_FOUND', 'No such session') : json(view(entry), 200);
    }],
    ['DELETE', /^\/memories\/([^/]+)$/, (m) => {
      const entry = find(m[1] ?? '');
      if (entry === undefined) return fail(404, 'NOT_FOUND', 'No such session');
      entries.splice(entries.indexOf(entry), 1);
      return { kind: 'empty', status: 204 };
    }],
  ];
  return { routes };
}
