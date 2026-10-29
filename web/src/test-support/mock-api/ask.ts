// Mock Ask box routes for `npm run dev:mock`: `POST /transcribe` answers one of a few spoken
// requests in turn (the mock gets no audio it could hear), and `POST /intents` reads a request with
// plain word rules in place of Muse Spark, under the same rules the API enforces (a short needs a
// source, an iGuide exactly one clip, add to project clips and a project, unclear 1–3 choices).
import type { IntentAnswer, Project } from '../../services/api/types';
import { fail, json, type MockRoute } from './reply';

/** What the mock "hears", in turn. */
export const MOCK_TRANSCRIPTS = [
  'make a 30 second short of the sunsets from our trip',
  'find the moment the coffee is poured',
  'make an iGuide from this so Mum can use it',
] as const;

/** Longest request the API reads, characters. */
const TEXT_MAX = 500;
/** Most clips one request may carry. */
const CLIPS_MAX = 20;
/** Longest title, characters. */
const TITLE_MAX = 60;
/** A short's length bounds and default, seconds. */
const TARGET_MIN = 3;
const TARGET_MAX = 90;
const TARGET_DEFAULT = 30;

const NONE: Omit<IntentAnswer, 'kind' | 'title'> = {
  query: null,
  source: null,
  project_id: null,
  new_project_name: null,
  clip_ids: [],
  target_s: null,
  aspect: null,
  choices: [],
};

const titleOf = (text: string): string => {
  const clean = text.trim();
  const title = clean.charAt(0).toUpperCase() + clean.slice(1);
  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1)}…` : title;
};

/** The words of a request that name what to look for ("the sunsets from our trip" → "sunsets trip"). */
function searchWords(text: string): string {
  const words = stripFiller(text);
  return words === '' ? text.trim() : words;
}

/** The request without its filler words; "" when nothing else is left. */
function stripFiller(text: string): string {
  const filler = /\b(make|a|an|the|of|from|our|my|with|short|video|second|seconds|\d+|s|please|find|show|me|moment|moments|when|is|for|this|so|can|use|it)\b/gi;
  return text.replace(filler, ' ').replace(/\s+/g, ' ').trim();
}

function targetOf(text: string): number {
  const match = /(\d+)\s*(?:s\b|sec|second)/i.exec(text);
  const value = match === null ? TARGET_DEFAULT : Number(match[1]);
  return Math.min(TARGET_MAX, Math.max(TARGET_MIN, value));
}

const unclear = (text: string, projects: readonly Project[]): IntentAnswer => {
  const project = projects[0];
  return {
    ...NONE,
    kind: 'unclear',
    title: 'Did you mean…',
    choices: [
      ...(project === undefined
        ? []
        : [{ label: `Make a short from ${project.name}`, text: `make a 30 second short from the ${project.name} project` }]),
      { label: `Just search “${searchWords(text)}”`, text: `find ${searchWords(text)}` },
    ],
  };
};

/**
 * Reads a request the way the mock does.
 * @param text - The request, trimmed.
 * @param clipIds - The clips added to the box.
 * @param projects - The caller's projects.
 * @returns The intent.
 */
export function mockIntent(text: string, clipIds: readonly string[], projects: readonly Project[]): IntentAnswer {
  const lower = text.toLowerCase();
  const project = projects.find((p) => lower.includes(p.name.toLowerCase()));
  if (/\bupload\b/.test(lower)) return { ...NONE, kind: 'upload', title: 'Upload clips from this Mac' };
  if (/\bi?guide\b/.test(lower)) {
    const first = clipIds[0];
    if (first === undefined) {
      return { ...NONE, kind: 'unclear', title: 'Did you mean…', choices: [{ label: 'Add the task video with +', text }] };
    }
    return { ...NONE, kind: 'make_guide', title: titleOf(text.replace(/^make an? i?guide (from this )?/i, '')), clip_ids: [first] };
  }
  if (/\bshort\b/.test(lower)) {
    const base = { ...NONE, kind: 'make_short' as const, title: titleOf(searchWords(text)), target_s: targetOf(text), aspect: '4:5' as const };
    if (clipIds.length > 0) return { ...base, source: 'attached', clip_ids: [...clipIds] };
    if (project !== undefined) {
      const words = stripFiller(lower.replace(project.name.toLowerCase(), '').replace(/\bproject\b/g, ''));
      return { ...base, source: 'project', project_id: project.project_id, query: words === '' ? null : words };
    }
    return { ...base, source: 'search', query: searchWords(text) };
  }
  if (/\bproject\b/.test(lower) && /\badd\b/.test(lower) && clipIds.length === 0) {
    // The API's rule: add to project needs clips; the choice resends the original request.
    return { ...NONE, kind: 'unclear', title: 'Did you mean…', choices: [{ label: 'Add clips with +', text }] };
  }
  if (/\bproject\b/.test(lower) && clipIds.length > 0) {
    const named = /\b(?:called|named)\s+(.+)$/i.exec(text)?.[1]?.trim() ?? null;
    if (project === undefined && named === null) return unclear(text, projects);
    return {
      ...NONE,
      kind: 'add_to_project',
      title: project === undefined ? `New project ${named ?? ''}`.trim() : `Add to ${project.name}`,
      project_id: project?.project_id ?? null,
      new_project_name: project === undefined ? named : null,
      clip_ids: [...clipIds],
    };
  }
  if (/\b(something|nice|stuff)\b/.test(lower)) return unclear(text, projects);
  return { ...NONE, kind: 'search', title: titleOf(text), query: searchWords(text) };
}

/**
 * Builds the Ask routes.
 * @param projects - The caller's projects as they are now.
 * @returns The routes.
 */
export function createAskMock(projects: () => readonly Project[]): { routes: MockRoute[] } {
  let heard = 0;
  const routes: MockRoute[] = [
    ['POST', /^\/transcribe$/, () => {
      const text = MOCK_TRANSCRIPTS[heard % MOCK_TRANSCRIPTS.length] ?? '';
      heard += 1;
      return json({ text }, 1200);
    }],
    ['POST', /^\/intents$/, (_m, req) => {
      const body = (req.body ?? {}) as { text?: unknown; clip_ids?: unknown };
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (text === '' || text.length > TEXT_MAX) return fail(400, 'VALIDATION_FAILED', 'text must be 1–500 characters');
      const clipIds = Array.isArray(body.clip_ids) ? body.clip_ids.filter((id): id is string => typeof id === 'string') : [];
      if (clipIds.length > CLIPS_MAX) return fail(400, 'VALIDATION_FAILED', 'at most 20 clips');
      return json(mockIntent(text, clipIds, projects()), 900);
    }],
  ];
  return { routes };
}
