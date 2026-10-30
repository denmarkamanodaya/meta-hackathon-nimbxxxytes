// Adding a recording: register it, then send the file itself (which starts the job; no complete
// call); a failure deletes the empty
// listen. Listen on a clip sends the clip and the remembered language and opens the listen. The
// output language is remembered on every pick.
import { act, useEffect } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAC_LISTEN_LIMIT, PWA_LISTEN_LIMIT } from '../core/ilisten/listens';
import type { ApiClient } from '../services/api/client';
import { createListenPrefsStore } from '../services/listen-prefs';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useAddListen, useChangeListenLanguage, useListenTarget, useListenToClip, type AddListen, type ChangeListenLanguage, type ListenTarget, type ListenToClip } from './useListens';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { add: AddListen | null; clip: ListenToClip | null; target: ListenTarget | null; change: ChangeListenLanguage | null; path: string } = {
  add: null,
  clip: null,
  target: null,
  change: null,
  path: '',
};
const onChanged = vi.fn();

function Probe() {
  const add = useAddListen();
  const clip = useListenToClip();
  const target = useListenTarget();
  const change = useChangeListenLanguage(onChanged);
  const path = useLocation().pathname;
  useEffect(() => {
    box.add = add;
    box.clip = clip;
    box.target = target;
    box.change = change;
    box.path = path;
  });
  return null;
}

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    length: 0,
    clear: () => undefined,
    key: () => null,
    getItem: (key) => items.get(key) ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

async function open(api: Partial<ApiClient>, listenLimit = PWA_LISTEN_LIMIT) {
  const listenPrefs = createListenPrefsStore(memoryStorage());
  const services = fakeServices({ api: fakeApi(api), listenPrefs, listenLimit });
  view = await mount(
    <MemoryRouter initialEntries={['/clips/c1']}>
      <Probe />
    </MemoryRouter>,
    services,
  );
  return { listenPrefs, toasts: services.toasts };
}

const started = (id: string, status: 'uploading' | 'listening') => vi.fn().mockResolvedValue({ listen_id: id, status });

describe('useAddListen', () => {
  it('creates, then sends the file, in that order, never completes, and resolves the id', async () => {
    const order: string[] = [];
    const createListen = vi.fn<ApiClient['createListen']>(() => {
      order.push('create');
      return Promise.resolve({ listen_id: 'l1', status: 'uploading' });
    });
    const sendListenSource = vi.fn<ApiClient['sendListenSource']>(() => {
      order.push('source');
      return Promise.resolve({ listen_id: 'l1', status: 'listening' });
    });
    const completeListen = vi.fn<ApiClient['completeListen']>(() => {
      order.push('complete');
      return Promise.resolve({ listen_id: 'l1', status: 'listening' });
    });
    await open({ createListen, sendListenSource, completeListen });
    const file = new File(['ID3'], 'party.mp3', { type: 'audio/mpeg' });

    let id: string | null = null;
    await act(async () => {
      id = (await box.add?.add(file, 'zh')) ?? null;
    });

    expect(createListen).toHaveBeenCalledWith({ filename: 'party.mp3', content_type: 'audio/mpeg', size_bytes: 3, clip_id: null, target: 'zh' });
    expect(sendListenSource).toHaveBeenCalledWith('l1', file);
    expect(completeListen).not.toHaveBeenCalled();
    expect(order).toEqual(['create', 'source']);
    expect(id).toBe('l1');
  });

  it('sends a typeless m4a with the type read from its name', async () => {
    const sendListenSource = started('l2', 'listening');
    await open({ createListen: started('l2', 'uploading'), sendListenSource });

    await act(async () => {
      await box.add?.add(new File(['m4a'], 'memo.m4a', { type: '' }), 'en');
    });

    const sent = sendListenSource.mock.calls[0]?.[1] as Blob;
    expect(sent.type).toBe('audio/x-m4a');
  });

  it('deletes the empty listen and says why when the file does not get there', async () => {
    const deleteListen = vi.fn<ApiClient['deleteListen']>().mockResolvedValue(true);
    await open({ createListen: started('l3', 'uploading'), sendListenSource: vi.fn().mockRejectedValue(new Error('offline')), deleteListen });

    let id: string | null = 'x';
    await act(async () => {
      id = (await box.add?.add(new File(['x'], 'a.wav', { type: 'audio/wav' }), 'en')) ?? null;
    });

    expect(id).toBeNull();
    expect(deleteListen).toHaveBeenCalledWith('l3');
    expect(box.add?.error).not.toBeNull();
  });

  it('on the Mac, keeps a file over 50 MB on the device and points at the library; the PWA sends it', async () => {
    const big = new File(['x'], 'long.mov', { type: 'video/quicktime' });
    Object.defineProperty(big, 'size', { value: 60 * 1024 * 1024 });
    const createListen = vi.fn<ApiClient['createListen']>().mockResolvedValue({ listen_id: 'l9', status: 'uploading' });
    await open({ createListen }, MAC_LISTEN_LIMIT);

    await act(async () => {
      await box.add?.add(big, 'en');
    });

    expect(createListen).not.toHaveBeenCalled();
    expect(box.add?.error).toBe('On the Mac, files up to 50 MB. For longer recordings, add the video to your library and press Listen on it.');
    view?.unmount();

    await open({ createListen, sendListenSource: started('l9', 'listening') });
    await act(async () => {
      await box.add?.add(big, 'en');
    });

    expect(createListen).toHaveBeenCalledWith(expect.objectContaining({ size_bytes: 60 * 1024 * 1024 }));
  });

  it('never sends a file it cannot listen to', async () => {
    const createListen = vi.fn<ApiClient['createListen']>();
    await open({ createListen });

    await act(async () => {
      await box.add?.add(new File(['%PDF'], 'a.pdf', { type: 'application/pdf' }), 'en');
    });

    expect(createListen).not.toHaveBeenCalled();
    expect(box.add?.error).toContain('sound files');
  });
});

describe('the language and a clip', () => {
  it('remembers the pick, and Listen on a clip sends it with the clip and opens the listen', async () => {
    const createListen = started('l4', 'listening');
    const { listenPrefs } = await open({ createListen });
    expect(box.target?.target).toBe('en');

    act(() => {
      box.target?.setTarget('ja');
    });
    await act(async () => {
      box.clip?.start('c1');
      await Promise.resolve();
    });

    expect(listenPrefs.readTarget()).toBe('ja');
    expect(createListen).toHaveBeenCalledWith({ filename: null, content_type: null, size_bytes: null, clip_id: 'c1', target: 'ja' });
    expect(box.path).toBe('/ilisten/l4');
  });

  it('changes a listen\'s language, remembers it and reloads', async () => {
    const changeListenLanguage = vi.fn<ApiClient['changeListenLanguage']>().mockResolvedValue({} as Awaited<ReturnType<ApiClient['changeListenLanguage']>>);
    const { listenPrefs } = await open({ changeListenLanguage });

    await act(async () => {
      await box.change?.change('lis_meeting', 'ko');
    });

    expect(changeListenLanguage).toHaveBeenCalledWith('lis_meeting', 'ko');
    expect(listenPrefs.readTarget()).toBe('ko');
    expect(onChanged).toHaveBeenCalled();
  });
});
