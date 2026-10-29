// A letter on the phone: Read it to me reads the summary first; hold to ask unlocks speech and
// playback in the tap, asks Muse Spark what was said, shows the answer in large type and reads it
// out loud. Behaviour change 2026-10-29: the device voice says the text; without one (the first
// tests) the server WAVs play.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import type { DocumentDetail } from '../services/api/types';
import { parseDocument } from '../services/api/parse-documents';
import type { VoiceRecorder, VoiceRecording } from '../services/media/voice-recorder';
import { SILENT_WAV_URL } from '../services/media/wav-url';
import documentsJson from '../test-support/fixtures/documents.json';
import { fakeSpeaker, type FakeSpeaker } from '../test-support/fake-speaker';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { IReadDocumentPage } from './IReadDocumentPage';

// jsdom has no pointer capture; the hold button asks for it on pointer down.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => undefined, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
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

const parsed = parseDocument(documentsJson[0]);
if (parsed === null) throw new Error('documents.json does not parse');
const bill: DocumentDetail = parsed;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((each) => each.textContent.includes(text));
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

async function open(api: Partial<ApiClient>, speaker: FakeSpeaker = fakeSpeaker(false)) {
  const stepAudio = { play: vi.fn<(url: string, onEnd: () => void) => void>(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), position: vi.fn(() => null) };
  const recording: VoiceRecording = { stop: vi.fn(() => Promise.resolve(new Blob(['n'], { type: 'audio/webm' }))), cancel: vi.fn() };
  const voice: VoiceRecorder = { start: vi.fn(() => Promise.resolve(recording)) };
  view = await mount(
    <MemoryRouter initialEntries={['/iread/doc_water']}>
      <Routes>
        <Route path="/iread/:id" element={<IReadDocumentPage />} />
      </Routes>
    </MemoryRouter>,
    fakeServices({ stepAudio, voice, speaker: speaker.speaker, api: fakeApi({ getDocument: vi.fn<ApiClient['getDocument']>().mockResolvedValue(bill), ...api }) }),
  );
  await advance(10);
  return { stepAudio, hold: button('Hold to ask a question') };
}

/** Holds the ask button for 1.5 s, then lets go. */
async function holdAndLetGo(hold: HTMLButtonElement) {
  await act(async () => {
    hold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
    await vi.advanceTimersByTimeAsync(1500);
  });
  await act(async () => {
    hold.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
    await vi.advanceTimersByTimeAsync(10);
  });
}

describe('IReadDocumentPage', () => {
  it('shows the title, who it is from and the summary in large type; Read it to me plays the summary first', async () => {
    const { stepAudio } = await open({});

    expect(document.querySelector('.back-header__title')?.textContent).toBe('Water bill, October');
    expect(document.querySelector('.back-header__subtitle')?.textContent).toBe('From Sunvale Water · 24 October');
    expect(document.querySelector('.iread-doc__big')?.textContent).toBe(bill.summary);

    await act(async () => {
      button('Read it to me').click();
      await Promise.resolve();
    });

    expect(stepAudio.play.mock.calls[0]?.[0]).toBe(bill.summary_audio_url);
    expect(button('Stop reading')).toBeDefined();
  });

  it('hold to ask: unlocks playback on let go, asks what was said, shows and reads the answer', async () => {
    const askDocument = vi.fn<ApiClient['askDocument']>().mockResolvedValue({ question: 'how do I pay?', answer: 'By phone on 1300 555 019.', audio_url: 'https://m/a.wav' });
    const { stepAudio } = await open({ askDocument, transcribe: vi.fn<ApiClient['transcribe']>().mockResolvedValue({ text: 'how do I pay?' }) });
    const hold = button('Hold to ask a question');

    await act(async () => {
      hold.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(document.querySelector('.iread-doc__hold--on')?.textContent).toContain('Listening… let go to ask');
    await act(async () => {
      hold.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1 }));
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(stepAudio.play.mock.calls[0]?.[0]).toBe(SILENT_WAV_URL);
    expect(askDocument).toHaveBeenCalledWith('doc_water', 'how do I pay?');
    expect(document.querySelector('.guide-page')?.textContent).toContain('You asked: “how do I pay?”');
    expect(document.querySelector('.iread-doc__big')?.textContent).toBe('By phone on 1300 555 019.');
    expect(stepAudio.play.mock.calls.at(-1)?.[0]).toBe('https://m/a.wav');
  });

  it('with a device voice: Read it to me says the stored summary, and the held question is answered in it', async () => {
    const speaker = fakeSpeaker(true);
    const askDocument = vi.fn<ApiClient['askDocument']>().mockResolvedValue({ question: 'how do I pay?', answer: 'By phone on 1300 555 019.', audio_url: null });
    const { stepAudio, hold } = await open({ askDocument, transcribe: vi.fn<ApiClient['transcribe']>().mockResolvedValue({ text: 'how do I pay?' }) }, speaker);

    await act(async () => {
      button('Read it to me').click();
      await Promise.resolve();
    });
    expect(speaker.spoken()).toEqual([bill.summary]);
    expect(stepAudio.play).not.toHaveBeenCalled();

    await holdAndLetGo(hold);

    expect(speaker.mocks.unlock).toHaveBeenCalled();
    expect(speaker.spoken().at(-1)).toBe('By phone on 1300 555 019.');
    expect(document.querySelector('.guide-page')?.textContent).not.toContain('Voice not available right now');
  });
});
