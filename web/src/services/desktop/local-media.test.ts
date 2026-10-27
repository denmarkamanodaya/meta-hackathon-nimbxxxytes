import { describe, expect, it } from 'vitest';
import { fakeTauri } from '../../test-support/fake-tauri';
import { createLocalMediaResolver } from './local-media';

const ref = { kind: 'proxy', id: 'c1', cloudUrl: 'https://s3.example/proxy.mp4?sig=1' } as const;

describe('createLocalMediaResolver', () => {
  it('asks media_lookup with kind and id and plays a synced path through the asset protocol', async () => {
    const tauri = fakeTauri({ media_lookup: { resolve: { path: '/Users/me/nimbytes/Library/Beach walk.mp4' } } });

    const url = await createLocalMediaResolver(tauri.ipc).resolve(ref);

    expect(tauri.calls).toEqual([{ command: 'media_lookup', args: { kind: 'proxy', id: 'c1' } }]);
    expect(url).toBe(`asset://localhost/${encodeURIComponent('/Users/me/nimbytes/Library/Beach walk.mp4')}`);
  });

  it('plays the cloud URL when the file is not synced (null path)', async () => {
    const tauri = fakeTauri({ media_lookup: { resolve: { path: null } } });

    await expect(createLocalMediaResolver(tauri.ipc).resolve(ref)).resolves.toBe(ref.cloudUrl);
  });

  it('plays the cloud URL when the lookup fails or answers something else', async () => {
    const failing = fakeTauri({ media_lookup: { reject: 'boom' } });
    const odd = fakeTauri({ media_lookup: { resolve: { path: 42 } } });

    await expect(createLocalMediaResolver(failing.ipc).resolve(ref)).resolves.toBe(ref.cloudUrl);
    await expect(createLocalMediaResolver(odd.ipc).resolve(ref)).resolves.toBe(ref.cloudUrl);
  });

  it('shows nothing before the lookup settles, so the cloud copy never starts first', () => {
    expect(createLocalMediaResolver(fakeTauri().ipc).immediate(ref)).toBeNull();
  });
});
