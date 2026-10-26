import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import type { UploadItem } from '../services/upload/queue';
import { isUploading, useKeepAwake, useUploads } from './useUploads';

const item = (state: UploadItem['state']): UploadItem => ({
  id: state,
  name: `${state}.mp4`,
  sizeBytes: 10,
  state,
  loadedBytes: 0,
  bytesPerSecond: null,
  resumed: false,
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
