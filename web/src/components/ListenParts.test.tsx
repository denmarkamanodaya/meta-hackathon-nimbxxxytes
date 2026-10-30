// Read it to me speaks the summary in a voice of its language, or in the English voice with a
// line saying so; What was said leads with the output language and switches to the original.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import listensJson from '../test-support/fixtures/listens.json';
import { parseListen } from '../services/api/parse-listens';
import type { ListenDetail } from '../services/api/types';
import { fakeSpeaker } from '../test-support/fake-speaker';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { ListenReadButton, TranscriptCard } from './ListenParts';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const fixture = (id: string): ListenDetail => {
  const listen = parseListen(listensJson.find((each) => each.id === id));
  if (listen === null) throw new Error(`no ${id}`);
  return listen;
};

const button = (label: string): HTMLButtonElement => {
  const found = [...(view?.container.querySelectorAll('button') ?? [])].find((each) => each.textContent.includes(label));
  if (found === undefined) throw new Error(`no button ${label}`);
  return found;
};

describe('ListenReadButton', () => {
  it('reads a 中文 summary in a Chinese voice', async () => {
    const speaker = fakeSpeaker(true);
    view = await mount(<ListenReadButton listen={fixture('lis_office')} className="b" messageClassName="m" />, fakeServices({ speaker: speaker.speaker }));

    act(() => {
      button('Read it to me').click();
    });

    expect(speaker.mocks.speak.mock.calls[0]?.[0]).toContain('仓库将于11月3日');
    expect(speaker.mocks.speak.mock.calls[0]?.[2]).toBe('zh');
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });

  it('falls back to the English voice with a note when the device has no Chinese voice', async () => {
    const speaker = fakeSpeaker(true);
    speaker.mocks.isAvailable.mockImplementation((language?: string) => language === undefined || language === 'en');
    view = await mount(<ListenReadButton listen={fixture('lis_office')} className="b" messageClassName="m" />, fakeServices({ speaker: speaker.speaker }));

    act(() => {
      button('Read it to me').click();
    });

    expect(speaker.mocks.speak.mock.calls[0]?.[2]).toBeUndefined();
    expect(view.container.querySelector('[role="status"]')?.textContent).toBe('No 中文 voice on this device, so the English voice reads it.');
  });
});

describe('TranscriptCard', () => {
  it('leads with the English, the original under it, marks the fixed line, and shows the original alone on Original', async () => {
    view = await mount(<TranscriptCard listen={fixture('lis_meeting')} />, fakeServices());
    const texts = () => [...(view?.container.querySelectorAll('.listen-turn__text') ?? [])].map((each) => each.textContent);

    expect(texts()[1]).toBe("Tomorrow's meeting starts at 10 AM. It's in the meeting room on the third floor.");
    expect(view.container.querySelectorAll('.listen-turn__orig')).toHaveLength(5);
    expect(view.container.querySelector('.listen-turn__fixed')?.textContent).toBe('fixed in v2');

    act(() => {
      button('Original').click();
    });

    expect(texts()[1]).toBe('明日の会議は午前十時からです。場所は三階の会議室です。');
    expect(view.container.querySelectorAll('.listen-turn__orig')).toHaveLength(0);
  });
});
