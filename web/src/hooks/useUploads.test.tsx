import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import type { ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import type { UploadItem } from '../services/upload/queue';
import { isUploading, useKeepAwake, usePickWithCheck, useUploads } from './useUploads';

const item = (state: UploadItem['state']): UploadItem => ({
  id: state,
  name: `${state}.mp4`,
  sizeBytes: 10,
  state,
  loadedBytes: 0,
  bytesPerSecond: null,
  resumed: false,
  partsDone: 0,
  partsTotal: 0,
  errorMessage: null,
  clipId: null,
});

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('isUploading', () => {
  it('is true while a file is queued or uploading, false once all are done or failed', () => {
    expect(isUploading([item('done'), item('queued')])).toBe(true);
    expect(isUploading([item('uploading')])).toBe(true);
    expect(isUploading([item('done'), item('failed')])).toBe(false);
  });
});

describe('useUploads', () => {
  it('renders the queue snapshot', async () => {
    const services = fakeServices();
    const snapshot = [item('uploading')]; // stable reference, as useSyncExternalStore requires
    services.uploads.getSnapshot = () => snapshot;
    function Probe() {
      return <output>{useUploads().items.map((i) => i.name).join(',')}</output>;
    }

    view = await mount(<Probe />, services);

    expect(view.container.textContent).toBe('uploading.mp4');
  });
});

describe('useKeepAwake', () => {
  it('passes the active flag to the wake lock keeper', async () => {
    const setActive = vi.fn();
    function Probe() {
      useKeepAwake(true);
      return null;
    }

    view = await mount(<Probe />, fakeServices({ wakeLock: { setActive, dispose: vi.fn() } }));

    expect(setActive).toHaveBeenCalledWith(true);
  });
});

describe('usePickWithCheck', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: 'video/mp4' });

  it('checks each file, queues fresh ones, and holds a match until Skip or Upload anyway', async () => {
    const checkUpload = vi.fn<ApiClient['checkUpload']>(({ filename }) =>
      Promise.resolve({ duplicate_of: filename === 'dog.mp4' ? { clip_id: 'c1', title: 'Sleepy old dog' } : null }),
    );
    const services = fakeServices({ api: fakeApi({ checkUpload }) });
    const add = vi.spyOn(services.uploads, 'add').mockImplementation(() => undefined);
    const probe: { current: ReturnType<typeof usePickWithCheck> | null } = { current: null };
    function Probe() {
      const handle = usePickWithCheck();
      useEffect(() => {
        probe.current = handle;
      });
      return <output>{handle.held.map((h) => `${h.file.name}:${h.title}`).join(',')}</output>;
    }
    view = await mount(<Probe />, services);
    const dog = file('dog.mp4', 4);
    const beach = file('beach.mp4', 3);

    await act(async () => {
      await probe.current?.pick([dog, beach]);
    });

    expect(checkUpload.mock.calls.map(([body]) => body)).toEqual([
      { filename: 'dog.mp4', size_bytes: 4 },
      { filename: 'beach.mp4', size_bytes: 3 },
    ]);
    expect(add).toHaveBeenCalledWith([beach]);
    expect(view.container.textContent).toBe('dog.mp4:Sleepy old dog');

    const heldId = probe.current?.held[0]?.id ?? '';
    act(() => {
      probe.current?.uploadAnyway(heldId);
    });
    expect(add).toHaveBeenLastCalledWith([dog]);
    expect(view.container.textContent).toBe('');
  });

  it('drops a skipped match without uploading it, and queues a file whose check failed', async () => {
    const checkUpload = vi
      .fn<ApiClient['checkUpload']>()
      .mockResolvedValueOnce({ duplicate_of: { clip_id: 'c1', title: 'Pier' } })
      .mockRejectedValueOnce(new Error('offline'));
    const services = fakeServices({ api: fakeApi({ checkUpload }) });
    const add = vi.spyOn(services.uploads, 'add').mockImplementation(() => undefined);
    const probe: { current: ReturnType<typeof usePickWithCheck> | null } = { current: null };
    function Probe() {
      const handle = usePickWithCheck();
      useEffect(() => {
        probe.current = handle;
      });
      return <output>{handle.held.length}</output>;
    }
    view = await mount(<Probe />, services);
    const pier = file('pier.mp4', 2);
    const offline = file('offline.mp4', 2);

    await act(async () => {
      await probe.current?.pick([pier, offline]);
    });
    act(() => {
      probe.current?.skip(probe.current.held[0]?.id ?? '');
    });

    expect(add.mock.calls).toEqual([[[offline]]]);
    expect(view.container.textContent).toBe('0');
  });
});
