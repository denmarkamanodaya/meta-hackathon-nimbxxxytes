import { describe, expect, it } from 'vitest';
import type { ClipDetail, ClipSummary, Project, SearchResult, ShortListItem } from '../services/api/types';
import {
  barItems,
  barView,
  EVERYTHING,
  groupHits,
  hasShellSearchBar,
  highlightParts,
  itemPath,
  matchRanges,
  moveIndex,
  queryWords,
  scopeLabel,
  scopeResults,
  titleChips,
  type BarView,
} from './search-bar';

const result = (segment_id: string, clip_id: string, start_s: number, end_s: number, extra: Partial<SearchResult> = {}): SearchResult => ({
  kind: 'moment',
  photo_id: null,
  segment_id,
  clip_id,
  start_s,
  end_s,
  thumb_url: null,
  reason: `Reason ${segment_id}`,
  score: 0.5,
  clip_filename: `${clip_id}.mov`,
  clip_title: `Title ${clip_id}`,
  recorded_at: null,
  faces: [],
  ...extra,
});

const clipSummary = (clip_id: string, title: string, project_ids: string[] = []): ClipSummary => ({
  clip_id,
  title,
  filename: `${clip_id}.mov`,
  duration_s: 60,
  recorded_at: null,
  status: 'ready',
  thumb_url: null,
  segment_count: 1,
  people: [],
  duplicate_of: null,
  near_copy_of: null,
  angles: 0,
  size_bytes: 1,
  project_ids,
  speech_count: 0,
  face_count: 0,
});

const detail = (clip_id: string, turns: [number, number, string][], segments: [string, string][] = []): ClipDetail => ({
  clip: clipSummary(clip_id, clip_id),
  proxy_url: null,
  segments: segments.map(([segment_id, description], idx) => ({
    segment_id,
    idx,
    start_s: 0,
    end_s: 10,
    description,
    actions: [],
    objects: [],
    place: null,
    mood: null,
    quality: null,
    hook_score: null,
    thumb_url: null,
  })),
  turns: turns.map(([start_s, end_s, text], index) => ({ turn_id: `t${String(index)}`, start_s, end_s, text, speaker_id: null })),
  speakers: [],
  tracks: [],
  links: [],
});

const short = (short_id: string, prompt: string): ShortListItem => ({
  short_id,
  prompt,
  aspect: '4:5',
  target_s: 30,
  status: 'ready',
  created_at: '2026-10-28T00:00:00Z',
  version_count: 1,
  best_score: null,
  thumb_url: null,
  caption: null,
});

const project = (project_id: string, name: string): Project => ({
  project_id,
  name,
  color: 'orange',
  clip_count: 1,
  duration_s: 0,
  size_bytes: 0,
  created_at: '2026-10-28T00:00:00Z',
  art_url: null,
  art_drawing: false,
  art_sources: [],
});

describe('queryWords', () => {
  it('lower-cases, splits on anything but letters and digits, drops one-letter words and repeats', () => {
    expect(queryWords('Happy, happy BIRTHDAY a 60th!')).toEqual(['happy', 'birthday', '60th']);
  });
});

describe('matchRanges', () => {
  it('joins matches with only spaces between them into one highlight', () => {
    const text = 'Happy happy birthday, all the best';
    expect(matchRanges(text, ['happy', 'birthday'])).toEqual([[0, 20]]);
  });

  it('matches at the start of a word only, ignoring case', () => {
    expect(matchRanges('Unhappy but happy', ['happy'])).toEqual([[12, 17]]);
    expect(matchRanges('A 60th BIRTHDAY stage', ['birthday'])).toEqual([[7, 15]]);
  });

  it('keeps matches apart when other words sit between them', () => {
    expect(matchRanges('toast and coffee', ['toast', 'coffee'])).toEqual([
      [0, 5],
      [10, 16],
    ]);
  });

  it('finds nothing for no words', () => {
    expect(matchRanges('anything', [])).toEqual([]);
  });
});

describe('highlightParts', () => {
  it('cuts the line into plain and matched pieces', () => {
    expect(highlightParts('a toast here', [[2, 7]])).toEqual([
      { text: 'a ', isMatch: false },
      { text: 'toast', isMatch: true },
      { text: ' here', isMatch: false },
    ]);
    expect(highlightParts('toast', [[0, 5]])).toEqual([{ text: 'toast', isMatch: true }]);
  });
});

describe('groupHits', () => {
  const details = new Map([['c1', detail('c1', [[1, 3, 'Okay, latte time'], [8, 10, 'Toast is ready, catch!']], [['s2', 'Sam passes the toast']])]]);

  it('makes a result Speech when a line said during it holds a query word, opening at that line', () => {
    const { speech, moments } = groupHits([result('s2', 'c1', 7.5, 15)], details, ['toast']);
    expect(speech).toEqual([{ kind: 'speech', result: result('s2', 'c1', 7.5, 15), line: 'Toast is ready, catch!', at: 8 }]);
    expect(moments).toEqual([]);
  });

  it('makes it a Moment when nothing said during it matches, shown with its description', () => {
    const { speech, moments } = groupHits([result('s2', 'c1', 7.5, 15)], details, ['sam']);
    expect(speech).toEqual([]);
    expect(moments.map((hit) => [hit.line, hit.at])).toEqual([['Sam passes the toast', 7.5]]);
  });

  it('ignores lines said outside the moment', () => {
    const { speech } = groupHits([result('s1', 'c1', 4, 7)], details, ['toast']);
    expect(speech).toEqual([]);
  });

  it('falls back to the reason, then the title, without a description', () => {
    const { moments } = groupHits(
      [result('sx', 'c1', 0, 1), result('sy', 'c9', 0, 1, { reason: null })],
      details,
      ['toast'],
    );
    expect(moments.map((hit) => hit.line)).toEqual(['Reason sx', 'Title c9']);
  });
});

describe('scopeResults', () => {
  const results = [
    result('a', 'c1', 0, 1, { faces: [{ name: 'Sam Lee', crop_url: null }] }),
    result('b', 'c2', 0, 1, { faces: [{ name: 'Ana', crop_url: null }] }),
    result('c', 'c3', 0, 1),
  ];

  it('keeps the project clips for a project', () => {
    const kept = scopeResults(results, { kind: 'project', projectId: 'p', name: 'P' }, ['x'], new Set(['c2']));
    expect(kept.map((r) => r.segment_id)).toEqual(['b']);
  });

  it('keeps moments with a named person matching the query for Faces', () => {
    expect(scopeResults(results, { kind: 'faces' }, ['sam'], new Set()).map((r) => r.segment_id)).toEqual(['a']);
  });

  it('keeps everything otherwise', () => {
    expect(scopeResults(results, { kind: 'speech' }, ['sam'], new Set())).toHaveLength(3);
  });
});

describe('titleChips', () => {
  const sources = {
    clips: [clipSummary('c1', '60th birthday celebration', ['p1']), clipSummary('c2', 'Walk to work')],
    shorts: [short('s1', 'Birthday highlights'), short('s2', 'Commute')],
    projects: [project('p1', '60th Birthday + Grad')],
  };

  it('finds titles holding a query word, clips then shorts then projects', () => {
    expect(titleChips(['happy', 'birthday'], sources, EVERYTHING)).toEqual([
      { kind: 'clip', id: 'c1', label: '60th birthday celebration', color: null },
      { kind: 'short', id: 's1', label: 'Short: Birthday highlights', color: null },
      { kind: 'project', id: 'p1', label: 'Project: 60th Birthday + Grad', color: 'orange' },
    ]);
  });

  it('names a short by its post caption when it has one', () => {
    const captioned = { ...sources, shorts: [{ ...short('s1', 'make a reel'), caption: 'Birthday reel' }] };
    expect(titleChips(['birthday'], captioned, EVERYTHING).filter((c) => c.kind === 'short').map((c) => c.label)).toEqual(['Short: Birthday reel']);
  });

  it('leaves out duplicate uploads', () => {
    const copies = { ...sources, clips: [clipSummary('c1', 'Morning coffee'), { ...clipSummary('c2', 'Morning coffee'), duplicate_of: 'c1' }] };
    expect(titleChips(['coffee'], copies, EVERYTHING).map((c) => c.id)).toEqual(['c1']);
  });

  it('ignores short and common words', () => {
    expect(titleChips(['to', 'the'], sources, EVERYTHING)).toEqual([]);
  });

  it('puts the best match first and keeps three of a kind', () => {
    const many = { ...sources, clips: ['a b', 'birthday', 'birthday cake', 'birthday x', 'birthday y'].map((t, i) => clipSummary(`k${String(i)}`, t)) };
    expect(titleChips(['birthday', 'cake'], many, EVERYTHING).filter((c) => c.kind === 'clip').map((c) => c.label)).toEqual([
      'birthday cake',
      'birthday',
      'birthday x',
    ]);
  });

  it('keeps a project scope to its own clips, and Speech to none', () => {
    expect(titleChips(['walk', 'birthday'], sources, { kind: 'project', projectId: 'p1', name: 'P' }).map((c) => c.id)).toEqual(['c1']);
    expect(titleChips(['birthday'], sources, { kind: 'speech' })).toEqual([]);
  });
});

describe('barView', () => {
  const details = new Map([['c1', detail('c1', [[0, 2, 'Happy birthday!']])]]);
  const results = [result('s1', 'c1', 0, 5), result('s2', 'c2', 0, 5)];
  const sources = { clips: [clipSummary('c1', 'Party', ['p1']), clipSummary('c2', 'Park')], shorts: [], projects: [] };

  it('groups Speech and Moments and counts every result for See all', () => {
    const view = barView(results, details, 'birthday', EVERYTHING, sources);
    expect(view.speech.map((h) => h.result.segment_id)).toEqual(['s1']);
    expect(view.moments.map((h) => h.result.segment_id)).toEqual(['s2']);
    expect(view.total).toBe(2);
  });

  it('shows one group for the Speech and Moments scopes', () => {
    expect(barView(results, details, 'birthday', { kind: 'speech' }, sources).moments).toEqual([]);
    expect(barView(results, details, 'birthday', { kind: 'moments' }, sources).speech).toEqual([]);
  });

  it('counts only the project moments for a project scope', () => {
    const view = barView(results, details, 'birthday', { kind: 'project', projectId: 'p1', name: 'P' }, sources);
    expect(view.total).toBe(1);
    expect(view.moments).toEqual([]);
  });
});

describe('barItems and moveIndex', () => {
  const hit = (id: string) => ({ kind: 'moment' as const, result: result(id, 'c1', 0, 1), line: id, at: 0 });
  const view: BarView = {
    speech: [hit('a')],
    moments: [hit('b'), hit('c'), hit('d'), hit('e')],
    photos: [],
    chips: [{ kind: 'project', id: 'p', label: 'Project: P', color: 'orange' }],
    total: 5,
  };

  it('lists shown rows in screen order, three per group, then chips, then See all', () => {
    const items = barItems(view);
    expect(items.map((item) => (item.kind === 'hit' ? item.hit.line : item.kind))).toEqual(['a', 'b', 'c', 'd', 'chip', 'all']);
  });

  it('wraps at both ends', () => {
    expect(moveIndex(0, 3, -1)).toBe(2);
    expect(moveIndex(2, 3, 1)).toBe(0);
    expect(moveIndex(1, 3, 1)).toBe(2);
    expect(moveIndex(4, 0, 1)).toBe(0);
  });
});

describe('itemPath', () => {
  it('opens a hit at its time, a chip at its page, and See all in the Gallery', () => {
    const hit = { kind: 'speech' as const, result: result('s', 'c 1', 0, 1), line: 'x', at: 8 };
    expect(itemPath({ kind: 'hit', hit }, 'q', EVERYTHING)).toBe('/clips/c%201?t=8');
    expect(itemPath({ kind: 'chip', chip: { kind: 'clip', id: 'c1', label: '', color: null } }, 'q', EVERYTHING)).toBe('/clips/c1');
    expect(itemPath({ kind: 'chip', chip: { kind: 'short', id: 's1', label: '', color: null } }, 'q', EVERYTHING)).toBe('/editor/s1');
    expect(itemPath({ kind: 'chip', chip: { kind: 'project', id: 'p1', label: '', color: 'orange' } }, 'q', EVERYTHING)).toBe('/projects/p1');
    expect(itemPath({ kind: 'all' }, 'happy day', EVERYTHING)).toBe('/?q=happy+day');
    expect(itemPath({ kind: 'all' }, 'cake', { kind: 'project', projectId: 'p1', name: 'P' })).toBe('/?q=cake&project=p1');
  });
});

describe('scopeLabel', () => {
  it('names the scope, or the project', () => {
    expect(scopeLabel(EVERYTHING)).toBe('Everything');
    expect(scopeLabel({ kind: 'faces' })).toBe('Faces');
    expect(scopeLabel({ kind: 'project', projectId: 'p', name: '60th Birthday' })).toBe('60th Birthday');
  });
});

describe('hasShellSearchBar', () => {
  it('leaves the bar out where a page keeps its own bottom action bar', () => {
    expect(hasShellSearchBar('/editor')).toBe(false);
    expect(hasShellSearchBar('/editor/s1/finish')).toBe(false);
    expect(hasShellSearchBar('/editor/s1/publish')).toBe(false);
  });

  it('draws it everywhere else', () => {
    expect(hasShellSearchBar('/shorts')).toBe(true);
    expect(hasShellSearchBar('/sync')).toBe(true);
    expect(hasShellSearchBar('/editor/s1')).toBe(true);
  });
});

describe('photos in the popover', () => {
  it('puts a photo in Photos with its reason, after the moments, and opens its page', () => {
    const photo = result('photo:ph_4210', '', 0, 0, { kind: 'photo', photo_id: 'ph_4210', reason: 'A gold 60 on a flower wall', clip_title: 'Flower backdrop' });
    const moment = result('s1', 'c1', 102, 109);

    const view = barView([photo, moment], new Map(), 'flower 60', EVERYTHING, { clips: [], shorts: [], projects: [] });

    expect(view.photos.map((hit) => [hit.kind, hit.line])).toEqual([['photo', 'A gold 60 on a flower wall']]);
    expect(view.moments.map((hit) => hit.result.segment_id)).toEqual(['s1']);
    expect(barItems(view).map((item) => (item.kind === 'hit' ? item.hit.kind : item.kind))).toEqual(['moment', 'photo', 'all']);
    expect(itemPath({ kind: 'hit', hit: view.photos[0] ?? { kind: 'photo', result: photo, line: '', at: 0 } }, 'flower 60', EVERYTHING)).toBe('/photos/ph_4210');
    expect(barView([photo], new Map(), 'flower', { kind: 'speech' }, { clips: [], shorts: [], projects: [] }).photos).toEqual([]);
  });
});
