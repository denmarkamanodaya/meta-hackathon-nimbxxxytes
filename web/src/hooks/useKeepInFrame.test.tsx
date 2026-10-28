import { act, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import type { ShortFinish } from '../services/api/types';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { timelineV1 } from '../test-support/shorts';
import { subjectsKey, useKeepInFrame, usePreviewProps, type KeepInFrame } from './useKeepInFrame';

const finish: ShortFinish = { blur_bystanders: true, title_text: null, speaker_colors: false, effect: 'none', keep_subject: true };
const clips = timelineV1().clips;

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const settle = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  });

describe('useKeepInFrame', () => {
  it('saves the switch through the finish update, with the rest of the finish unchanged', async () => {
    const getFinish = vi.fn<ApiClient['getFinish']>().mockResolvedValue(finish);
    const saveFinish = vi.fn<ApiClient['saveFinish']>().mockResolvedValue({ ...finish, keep_subject: false });
    const getReframe = vi.fn<ApiClient['getReframe']>().mockResolvedValue({ status: 'ready', shots: [] });
    const seen: { keep: KeepInFrame | null } = { keep: null };
    function Probe() {
      const keep = useKeepInFrame('sh_1', clips);
      useEffect(() => {
        seen.keep = keep;
      });
      return <output>{String(keep.finish?.keep_subject)}</output>;
    }
    view = await mount(<Probe />, fakeServices({ api: fakeApi({ getFinish, saveFinish, getReframe }) }));
    await settle();
    expect(view.container.textContent).toBe('true');

    await act(async () => {
      seen.keep?.setKeepSubject(false);
      await Promise.resolve();
    });
    await settle();

    expect(saveFinish).toHaveBeenCalledWith('sh_1', { ...finish, keep_subject: false });
    expect(view.container.textContent).toBe('false');
  });

  it('keys the subjects so a changed one makes a new key', () => {
    expect(subjectsKey(clips)).toBe('s3=the latte art|s7=');
    expect(subjectsKey(clips.map((c) => ({ ...c, subject: 'dog' })))).not.toBe(subjectsKey(clips));
  });

  it('plays the props as they are when following, and without crop paths for the centre crop', async () => {
    const props = { clips: [{ segment_id: 's1', crop_path: [{ t_s: 0, cx: 0.3, cy: 0.5 }] }] };
    const seen: unknown[] = [];
    function Probe({ follow }: { follow: boolean }) {
      seen.push(usePreviewProps(props, follow));
      return null;
    }
    view = await mount(<Probe follow />, fakeServices());
    view.rerender(<Probe follow={false} />);

    expect(seen[0]).toBe(props);
    expect(seen[seen.length - 1]).toEqual({ clips: [{ segment_id: 's1' }] });
  });
});
