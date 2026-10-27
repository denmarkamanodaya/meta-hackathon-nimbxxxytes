import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaResolver } from '../core/ports/media-resolver';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { usePlayableUrl } from './usePlayableUrl';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

function Probe({ url }: { url: string | null }) {
  return <span>{usePlayableUrl('proxy', 'c1', url) ?? 'none'}</span>;
}

/** Resolver that waits for the test to answer, like the Mac app's media_lookup. */
function pendingResolver() {
  let answer: (url: string) => void = () => undefined;
  const media: MediaResolver = {
    immediate: () => null,
    resolve: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  };
  return { media, answer: (url: string) => { answer(url); } };
}

describe('usePlayableUrl', () => {
  it('plays the cloud URL on the first render in the PWA', async () => {
    view = await mount(<Probe url="https://s3/p.mp4" />, fakeServices());

    expect(view.container.textContent).toBe('https://s3/p.mp4');
  });

  it('shows nothing while there is no file', async () => {
    view = await mount(<Probe url={null} />, fakeServices());

    expect(view.container.textContent).toBe('none');
  });

  it('waits for the lookup in the Mac app, then plays the local copy', async () => {
    const { media, answer } = pendingResolver();
    view = await mount(<Probe url="https://s3/p.mp4" />, fakeServices({ media }));
    expect(view.container.textContent).toBe('none');

    await act(async () => {
      answer('asset://localhost/p.mp4');
      await Promise.resolve();
    });

    expect(view.container.textContent).toBe('asset://localhost/p.mp4');
  });

  it('follows a new presigned URL when the file is not on disk', async () => {
    const { media, answer } = pendingResolver();
    view = await mount(<Probe url="https://s3/p.mp4?sig=1" />, fakeServices({ media }));
    await act(async () => {
      answer('https://s3/p.mp4?sig=1');
      await Promise.resolve();
    });

    view.rerender(<Probe url="https://s3/p.mp4?sig=2" />);

    expect(view.container.textContent).toBe('https://s3/p.mp4?sig=2');
  });
});
