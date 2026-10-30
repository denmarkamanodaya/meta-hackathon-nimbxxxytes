import { describe, expect, it } from 'vitest';
import type { IntentAnswer } from '../../services/api/types';
import { cardBadge, intentTag, isAddClipsChoice, memoryPlanLine, planRows, planSettings, unclearLine, type PlanContext } from './plan';

const ctx: PlanContext = {
  projectName: (id) => (id === 'prj_thai' ? 'Thai Trip' : null),
  projectClipCount: (id) => (id === 'prj_thai' ? 4 : null),
};

const intent = (patch: Partial<IntentAnswer>): IntentAnswer => ({
  kind: 'search',
  title: 'T',
  query: null,
  source: null,
  project_id: null,
  new_project_name: null,
  clip_ids: [],
  target_s: null,
  aspect: null,
  choices: [],
  document_ids: [],
  question: null,
  person_id: null,
  clip_id: null,
  viewer_id: null,
  ...patch,
});

const short = (patch: Partial<IntentAnswer>) => intent({ kind: 'make_short', target_s: 30, aspect: '4:5', ...patch });

describe('Ask plan', () => {
  it('tags the box and badges the card by kind', () => {
    expect(intentTag('make_short')).toBe('Short');
    expect(intentTag('unclear')).toBe('Not sure yet');
    expect(cardBadge('unclear')).toBe('Ask');
    expect(cardBadge('make_guide')).toBe('iGuide');
  });

  it("lists a short's four steps with their models, the first worded by where the moments come from", () => {
    const rows = planRows(short({ source: 'project', project_id: 'prj_thai' }), ctx);

    expect(rows.map((row) => row.label)).toEqual(['Find the moments', 'Plan the cut', 'Cut, caption, blur hidden faces', 'Review and fix']);
    expect(rows.map((row) => row.tool)).toEqual(['Muse Spark', 'Muse Spark', 'Renderer + SAM 3.1', 'Muse Spark']);
    expect(rows[0]?.detail).toBe('Thai Trip · 4 clips');
    expect(rows[2]?.detail).toBe('4:5, about 30 s');
    expect(planRows(short({ source: 'search', query: 'sunsets' }), ctx)[0]).toEqual({ label: 'Find the moments', detail: 'Search “sunsets”', tool: 'Search + Muse Spark' });
    expect(planRows(short({ source: 'attached', clip_ids: ['a', 'b'] }), ctx)[0]?.detail).toBe('From 2 clips you added');
    expect(planRows(short({ source: 'project', project_id: 'prj_thai', query: 'sunsets' }), ctx)[0]?.detail).toBe('“sunsets” in Thai Trip');
  });

  it("lists a guide's four stages with the models the guide pipeline names", () => {
    const rows = planRows(intent({ kind: 'make_guide', clip_ids: ['c'] }), ctx);

    expect(rows.map((row) => `${row.label} · ${row.tool}`)).toEqual([
      'Find the steps · Muse Spark',
      'Frame each step · ffmpeg',
      'Circle the controls · SAM 3.1',
      'Backup voice for each step · MMS-TTS backup',
    ]);
  });

  it('lists the Memory Lane steps with their models and settings', () => {
    const memory = intent({ kind: 'memory_lane', person_id: 'p_kristoff', viewer_id: 'p_eric' });

    expect(intentTag('memory_lane')).toBe('Memory Lane');
    expect(planRows(memory, ctx).map((row) => `${row.label} · ${row.tool}`)).toEqual([
      'Find the moments · SAM 3.1 faces · Perception Encoder',
      'Write the session · Muse Spark sees faces and frames',
      'Check every line · Muse Spark',
      'Paint the cover · Muse Image',
    ]);
    expect(planSettings(memory, ctx)).toEqual([
      { label: 'Voice', value: 'Your device' },
      { label: 'Moments', value: '6–8' },
    ]);
  });

  it("words a Memory Lane card by its viewer and its person or day ('Show Eric his memories of his 60th birthday')", () => {
    const names: PlanContext = {
      ...ctx,
      personName: (id) => ({ p_eric: 'Eric', p_ann: 'Ann' })[id] ?? null,
      clipTitle: (id) => (id === 'c_60' ? '60th birthday' : null),
    };
    const day = intent({ kind: 'memory_lane', title: 'Eric’s 60th birthday memories', clip_id: 'c_60', viewer_id: 'p_eric' });

    expect(memoryPlanLine(day, names)).toBe('For Eric · 60th birthday');
    expect(planRows(day, names)[0]?.detail).toBe('From 60th birthday: the best moments, by who is in them');
    expect(planRows(intent({ kind: 'memory_lane', person_id: 'p_ann' }), names)[0]?.detail).toBe('With Ann: the best moments, by who is in them');
    expect(memoryPlanLine(intent({ kind: 'memory_lane', person_id: 'p_ann' }), names)).toBe('For anyone · Ann');
    expect(memoryPlanLine(day, ctx)).toBe('For anyone');
  });

  it('lists the iRead steps; reading is already done for a read page, with its pages and words', () => {
    const read = intent({ kind: 'read_document', document_ids: ['d1'], question: 'summarise this' });
    const facts = { title: 'Water bill', isRead: true, pageCount: 1, text: 'You owe $142.60 by 14 November.' };
    const rows = planRows(read, { ...ctx, documentFacts: (id) => (id === 'd1' ? facts : null) });

    expect(intentTag('read_document')).toBe('iRead');
    expect(rows.map((row) => `${row.label} · ${row.tool}`)).toEqual([
      'Read the page · Muse Spark',
      'Answer your question · Muse Spark',
      'Read it out loud · Your device',
    ]);
    expect(rows[0]?.detail).toBe('Already read: 1 page, 6 words');
    expect(planRows(read, { ...ctx, documentFacts: () => ({ ...facts, isRead: false }) })[0]?.detail).toBe('Reading the page now');
    expect(planRows(read, ctx)[0]?.detail).toBe('A photo or PDF, read once');
  });

  it('makes a new project first only when the request names a new one', () => {
    expect(planRows(intent({ kind: 'add_to_project', clip_ids: ['a'], new_project_name: 'Beach' }), ctx).map((r) => r.label)).toEqual(['Make the segment', 'Add 1 clip']);
    expect(planRows(intent({ kind: 'add_to_project', clip_ids: ['a', 'b'], project_id: 'prj_thai' }), ctx)).toEqual([{ label: 'Add 2 clips', detail: 'To Thai Trip', tool: '' }]);
  });

  it('has no rows for a search or a question back, and settings only for a short and a guide', () => {
    expect(planRows(intent({ kind: 'search' }), ctx)).toEqual([]);
    expect(planRows(intent({ kind: 'unclear' }), ctx)).toEqual([]);
    expect(planSettings(short({ source: 'project', project_id: 'prj_thai', target_s: 45 }), ctx)).toEqual([
      { label: 'Length', value: '45 s' },
      { label: 'Shape', value: '4:5' },
      { label: 'From', value: 'Thai Trip · 4 clips' },
    ]);
    expect(planSettings(intent({ kind: 'make_guide' }), ctx).map((s) => s.label)).toEqual(['Voice', 'Steps']);
    expect(planSettings(intent({ kind: 'upload' }), ctx)).toEqual([]);
  });

  it('words the question back and spots the choice that asks for clips first', () => {
    expect(unclearLine(' something nice ')).toBe('“something nice” could be a few things.');
    expect(isAddClipsChoice({ label: 'Add the task video with +', text: 'make a guide ' }, 'make a guide')).toBe(true);
    expect(isAddClipsChoice({ label: 'Add clips with +', text: 'put them in a project' }, 'put these in a project')).toBe(true);
    expect(isAddClipsChoice({ label: 'Just search “birthday”', text: 'find birthday' }, 'something nice')).toBe(false);
  });
});
