import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Services } from '../../hooks/services-context';
import { useFocusSearch } from '../../hooks/useSearchBar';
import { parseDocument } from '../../services/api/parse-documents';
import documentsJson from '../../test-support/fixtures/documents.json';
import type { ApiClient } from '../../services/api/client';
import type { ClipDetail, IntentAnswer, SearchResponse, SearchResult } from '../../services/api/types';
import { createNativeBridge } from '../../services/desktop/native-bridge';
import { fakeTauri } from '../../test-support/fake-tauri';
import { fakeApi, fakeServices, mount, type Mounted } from '../../test-support/services';
import { MacColumns } from './MacColumns';
import { MacSearchDock, MacSearchProvider } from './MacSearchBar';

// jsdom has no modal dialogs (the + sheet); open and close just set the attribute.
const dialog = HTMLDialogElement.prototype;
const real = { showModal: Object.getOwnPropertyDescriptor(dialog, 'showModal'), close: Object.getOwnPropertyDescriptor(dialog, 'close') };
beforeAll(() => {
  dialog.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  dialog.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});
afterAll(() => {
  for (const [name, descriptor] of Object.entries(real)) {
    if (descriptor === undefined) Reflect.deleteProperty(dialog, name);
    else Object.defineProperty(dialog, name, descriptor);
  }
});

let view: Mounted | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  view?.unmount();
  view = null;
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const row = (segment_id: string, clip_id: string, start_s: number, end_s: number): SearchResult => ({
  segment_id,
  clip_id,
  start_s,
  end_s,
  thumb_url: null,
  reason: `Reason ${segment_id}`,
  score: 0.5,
  clip_filename: 'a.mov',
  clip_title: `Clip ${clip_id}`,
  recorded_at: null,
  faces: [],
});

const answer: SearchResponse = {
  rewritten: { keywords: ['toast'], filters: { people: [], speakers: [], place: null, from: null, to: null, min_quality: null } },
  results: [row('s1', 'c1', 7.5, 15), row('s2', 'c2', 30, 37)],
  reranked: true,
  took_ms: 900,
  cached: false,
  cost_usd: 0.003,
};

const detail = (clip_id: string, text: string): ClipDetail => ({
  clip: {
    clip_id,
    title: `Clip ${clip_id}`,
    filename: 'a.mov',
    duration_s: 60,
    recorded_at: null,
    status: 'ready',
    thumb_url: null,
    segment_count: 1,
    people: [],
    duplicate_of: null,
    size_bytes: 1,
    project_ids: [],
    speech_count: 1,
    face_count: 0,
  },
  proxy_url: null,
  segments: [],
  turns: [{ turn_id: 't', start_s: 8, end_s: 10, text, speaker_id: null }],
  speakers: [],
  tracks: [],
});

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function FindMoments() {
  const focus = useFocusSearch();
  return (
    <button
      type="button"
      onClick={() => {
        focus('toast');
      }}
    >
      Find moments
    </button>
  );
}

async function open(api: Partial<ApiClient> = {}, extra: Partial<Services> = {}) {
  const searchStream = vi.fn<ApiClient['searchStream']>((_query, onStage) => {
    onStage({ stage: 'ranked', response: answer });
    return Promise.resolve();
  });
  view = await mount(
    <MemoryRouter initialEntries={['/shorts']}>
      <MacSearchProvider>
        <Routes>
          <Route
            path="*"
            element={
              <MacColumns>
                <FindMoments />
              </MacColumns>
            }
          />
        </Routes>
        <MacSearchDock />
        <Where />
      </MacSearchProvider>
    </MemoryRouter>,
    fakeServices({
      api: fakeApi({
        searchStream,
        getClip: vi.fn<ApiClient['getClip']>((id) => Promise.resolve(detail(id, id === 'c1' ? 'Toast is ready, catch!' : 'Nice save'))),
        listClips: vi.fn<ApiClient['listClips']>().mockResolvedValue([]),
        listShorts: vi.fn<ApiClient['listShorts']>().mockResolvedValue([]),
        listProjects: vi.fn<ApiClient['listProjects']>().mockResolvedValue([]),
        ...api,
      }),
      desktop: createNativeBridge(fakeTauri({ pick_and_upload: { resolve: { queued: 0 } } }).ipc),
      ...extra,
    }),
  );
  return { page: view, searchStream };
}

const input = () => document.querySelector<HTMLTextAreaElement>('.mac-ask__input');
const where = () => document.querySelector('[data-testid="where"]')?.textContent;

async function type(text: string) {
  const field = input();
  if (field === null) throw new Error('no search bar');
  await act(async () => {
    field.focus();
    // React tracks the value it set; the prototype's setter writes past that, like typing does.
    Reflect.set(HTMLTextAreaElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await advance(400);
}

async function press(key: string, init: KeyboardEventInit = {}) {
  await act(async () => {
    input()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
  });
}

describe('Mac search bar', () => {
  it('sits in the page middle column, and ⌘K from anywhere puts the cursor in it', async () => {
    await open();
    expect(document.querySelector('.mac-columns__main .mac-search')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      await Promise.resolve();
    });
    await advance(20);
    expect(document.activeElement).toBe(input());
  });

  it('a screen can send the owner to the bar with a query typed in', async () => {
    await open();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button:not(.mac-search__scope)')?.click();
      await Promise.resolve();
    });
    await advance(20);
    expect(input()?.value).toBe('toast');
    expect(document.activeElement).toBe(input());
  });

  it('searches after a pause and sorts the answer into Speech and Moments by what was said', async () => {
    const { searchStream } = await open();
    await type('toast');

    expect(searchStream).toHaveBeenCalledTimes(1);
    expect(searchStream).toHaveBeenCalledWith('toast', expect.any(Function), expect.any(AbortSignal));
    const text = document.querySelector('.mac-search__popover')?.textContent ?? '';
    expect(text).toContain('Speech · 1');
    expect(text).toContain('“Toast is ready, catch!”');
    expect(text).toContain('Moments · 1');
    expect(text).toContain('See all 2 results in the Gallery');
    expect(document.querySelector('.mac-search__match')?.textContent).toBe('Toast');
  });

  // Behaviour change (Ask box): no row is picked until ↑/↓, so the first ↓ picks the first row.
  it('↓ ↓ then ⏎ opens the highlighted moment at its time', async () => {
    await open();
    await type('toast');
    expect(document.querySelector('.mac-search__row[aria-selected="true"]')).toBeNull();
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');

    expect(where()).toBe('/clips/c2?t=30');
    expect(input()?.value).toBe('');
  });

  it('↓ then ⏎ opens the speech line where it is said', async () => {
    await open();
    await type('toast');
    await press('ArrowDown');
    await press('Enter');

    expect(where()).toBe('/clips/c1?t=8');
  });

  it('⌘⏎ shows every result in the Gallery and keeps the query in the bar', async () => {
    await open();
    await type('toast');
    await press('Enter', { metaKey: true });

    expect(where()).toBe('/?q=toast');
    expect(input()?.value).toBe('toast');
  });

  it('Esc closes the popover and leaves the bar', async () => {
    await open();
    await type('toast');
    expect(document.querySelector('.mac-search__popover')).not.toBeNull();

    await press('Escape');
    expect(document.querySelector('.mac-search__popover')).toBeNull();
    expect(document.activeElement).not.toBe(input());
  });

  it('does not search a single letter', async () => {
    const { searchStream } = await open();
    await type('t');
    expect(searchStream).not.toHaveBeenCalled();
    expect(document.querySelector('.mac-search__popover')).toBeNull();
  });
});

const intent = (patch: Partial<IntentAnswer>): IntentAnswer => ({
  kind: 'search',
  title: 'Thai trip sunsets',
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
  ...patch,
});

const click = (selector: string, text?: string) =>
  act(async () => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    const target = text === undefined ? all[0] : all.find((each) => each.textContent.includes(text));
    if (target === undefined) throw new Error(`nothing to click: ${selector} ${text ?? ''}`);
    target.click();
    await Promise.resolve();
  });

describe('Mac Ask box', () => {
  it('sits in the 96 px box with the mic and send; ⏎ with no row picked sends the request, and a search opens every result', async () => {
    const readIntent = vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'search', query: 'toast' }));
    await open({ readIntent });
    expect(document.querySelector('.mac-ask__box [aria-label="Hold to speak your request"]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('.mac-ask__send')?.disabled).toBe(true);

    await type('toast please');
    await press('Enter');
    await advance(10);

    expect(readIntent).toHaveBeenCalledWith({ text: 'toast please', clip_ids: [], document_ids: [] });
    expect(where()).toBe('/?q=toast');
    expect(document.querySelector('.mac-ask__tag')?.textContent).toBe('Search');
  });

  it('a short waits as a plan card above the box, with its steps, until Run', async () => {
    const createShort = vi.fn<ApiClient['createShort']>().mockResolvedValue({ short_id: 'sh1' });
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_short', source: 'search', query: 'toast', target_s: 30, aspect: '4:5' })),
      search: vi.fn<ApiClient['search']>().mockResolvedValue(answer),
      createShort,
      getShort: vi.fn<ApiClient['getShort']>(() => new Promise(() => undefined)),
    });

    await type('make a short of the toast');
    await press('Enter');
    await advance(10);

    const card = document.querySelector('.ask-card')?.textContent ?? '';
    expect(card).toContain('Thai trip sunsets');
    expect(card).toContain('Planned by Muse Spark');
    expect(card).toContain('Find the moments');
    expect(card).toContain('Search “toast”');
    expect(document.querySelector('.mac-search__popover')).toBeNull();
    expect(document.querySelector('.mac-ask__tag')?.textContent).toBe('Short');
    expect(createShort).not.toHaveBeenCalled();

    await click('.ask-card button', 'Run');
    await advance(10);

    expect(createShort).toHaveBeenCalledWith({ segment_ids: ['s1', 's2'], prompt: 'make a short of the toast', target_s: 30, aspect: '4:5' });
    expect(document.querySelector('.ask-card')?.textContent).toContain('Working');
    expect(input()?.value).toBe('');
  });

  it('a "…with +" choice opens + and the same request goes again with the clips added', async () => {
    const readIntent = vi
      .fn<ApiClient['readIntent']>()
      .mockResolvedValueOnce(intent({ kind: 'unclear', choices: [{ label: 'Add the task video with +', text: 'make a guide' }] }))
      .mockResolvedValueOnce(intent({ kind: 'make_guide', title: 'Toast guide', clip_ids: ['c1'] }));
    await open({
      readIntent,
      listClips: vi.fn<ApiClient['listClips']>().mockResolvedValue([detail('c1', 'x').clip]),
    });

    await type('make a guide');
    await press('Enter');
    await advance(10);
    expect(document.querySelector('.ask-card')?.textContent).toContain('Did you mean…');

    await click('.ask-card__choice', 'Add the task video with +');
    await click('.mac-ask__plus-item', 'Add clips from Gallery…');
    await advance(10);
    await act(async () => {
      document.querySelector<HTMLInputElement>('.add-clips__row input')?.click();
      await Promise.resolve();
    });
    await click('.new-project__create');
    await advance(10);

    expect(readIntent).toHaveBeenLastCalledWith({ text: 'make a guide', clip_ids: ['c1'], document_ids: [] });
    expect(document.querySelector('.mac-ask__chip')?.textContent).toContain('Clip c1');
    expect(document.querySelector('.ask-card')?.textContent).toContain('Make iGuide');
  });

  it('shows a "2 working" pill while two jobs run, and its list opens a job', async () => {
    await open({
      readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'make_guide', title: 'Guide', clip_ids: ['c1'] })),
      startGuide: vi.fn<ApiClient['startGuide']>().mockResolvedValue({ guide_id: 'g1', status: 'queued' }),
      getGuide: vi.fn<ApiClient['getGuide']>(() => new Promise(() => undefined)),
    });

    for (const text of ['make a guide', 'make another guide']) {
      await type(text);
      await press('Enter');
      await advance(10);
      await click('.ask-card button', 'Make iGuide');
      await advance(10);
    }

    expect(document.querySelector('.ask-queue__pill')?.textContent).toBe('2 working');
    await click('.ask-queue__pill');
    expect(document.querySelectorAll('.ask-queue__row')).toHaveLength(2);
    await click('.ask-queue__row');
    expect(document.querySelector('.ask-queue__list')).toBeNull();
    expect(document.querySelector('.ask-card')?.textContent).toContain('Working');
  });

  it('Add a document… puts the letter in the box with its page; Read and answer reads it and says the answer once', async () => {
    const bill = parseDocument(documentsJson[0]);
    if (bill === null) throw new Error('documents.json does not parse');
    const readIntent = vi.fn<ApiClient['readIntent']>().mockResolvedValue(
      intent({ kind: 'read_document', title: 'Summarise this letter', document_ids: [bill.id], question: 'summarise this letter for me' }),
    );
    const askDocument = vi.fn<ApiClient['askDocument']>().mockResolvedValue({ question: 'summarise this letter for me', answer: 'You owe $142.60.', audio_url: 'https://m/answer.wav' });
    const speakDocument = vi.fn<ApiClient['speakDocument']>().mockResolvedValue({ part: 0, parts: 1, text: 'x', audio_url: 'https://m/p0.wav' });
    const stepAudio = { play: vi.fn<(url: string, onEnd: () => void) => void>(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position: vi.fn(() => null) };
    await open(
      {
        readIntent,
        listDocuments: vi.fn<ApiClient['listDocuments']>().mockResolvedValue([bill]),
        getDocument: vi.fn<ApiClient['getDocument']>().mockResolvedValue(bill),
        askDocument,
        speakDocument,
      },
      { stepAudio },
    );

    await click('.mac-ask__button[aria-label="Add clips, a document or upload"]');
    await click('.mac-ask__plus-item', 'Add a document…');
    await advance(10);
    await click('.add-doc__row', 'Water bill, October');
    expect(document.querySelector('.mac-ask__chip')?.textContent).toContain('Water bill, October1 page');
    expect(document.querySelector('.mac-ask__chip-thumb--page img')?.getAttribute('src')).toBe(bill.thumb_url);

    await type('summarise this letter for me');
    await press('Enter');
    await advance(10);
    expect(readIntent).toHaveBeenCalledWith({ text: 'summarise this letter for me', clip_ids: [], document_ids: ['doc_water'] });
    const plan = document.querySelector('.ask-card')?.textContent ?? '';
    expect(plan).toContain('Water bill, October');
    expect(plan).toContain('You asked: “summarise this letter for me”');
    expect(plan).toContain('Already read: 1 page, 58 words');
    expect(document.querySelector('.mac-ask__tag')?.textContent).toBe('iRead');

    await click('.ask-card button', 'Read and answer');
    await advance(10);

    expect(askDocument).toHaveBeenCalledWith('doc_water', 'summarise this letter for me');
    expect(document.querySelector('.ask-read__answer')?.textContent).toBe('You owe $142.60.');
    expect(document.querySelector('.ask-card')?.textContent).toContain('Answered by Muse Spark');
    expect(stepAudio.play.mock.calls.map(([url]) => url)).toEqual(['https://m/answer.wav']);

    await click('.ask-card button', 'Read the whole letter');
    await advance(10);
    expect(speakDocument).toHaveBeenCalledWith('doc_water', 0);
    expect(stepAudio.play.mock.calls.map(([url]) => url)).toContain('https://m/p0.wav');
  });

  it('an answer with no voice shows the text and the no-voice line, and plays nothing', async () => {
    const bill = parseDocument(documentsJson[0]);
    if (bill === null) throw new Error('documents.json does not parse');
    const stepAudio = { play: vi.fn<(url: string, onEnd: () => void) => void>(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position: vi.fn(() => null) };
    await open(
      {
        readIntent: vi.fn<ApiClient['readIntent']>().mockResolvedValue(intent({ kind: 'read_document', document_ids: [bill.id], question: 'how do I pay?' })),
        listDocuments: vi.fn<ApiClient['listDocuments']>().mockResolvedValue([bill]),
        getDocument: vi.fn<ApiClient['getDocument']>().mockResolvedValue(bill),
        askDocument: vi.fn<ApiClient['askDocument']>().mockResolvedValue({ question: 'how do I pay?', answer: 'By phone.', audio_url: null }),
      },
      { stepAudio },
    );

    await type('how do I pay my water bill?');
    await press('Enter');
    await advance(10);
    await click('.ask-card button', 'Read and answer');
    await advance(10);

    expect(document.querySelector('.ask-read__answer')?.textContent).toBe('By phone.');
    expect(document.querySelector('.read-bar__none')?.textContent).toBe('Voice not available right now');
    expect(document.querySelector('.read-bar__play')).toBeNull();
    expect(stepAudio.play).not.toHaveBeenCalled();
  });
});
