import { act, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useOptimisticPatches, type OptimisticPatches } from './useOptimisticPatches';

interface Row {
  id: string;
  name: string | null;
}

const rows: Row[] = [{ id: 'a', name: null }];
const idOf = (row: Row) => row.id;
const handle: { commit: OptimisticPatches<Row>['commit'] | null } = { commit: null };

function Probe() {
  const { apply, commit, error } = useOptimisticPatches(idOf);
  useEffect(() => {
    handle.commit = commit;
  });
  return <output>{`${apply(rows)[0]?.name ?? 'none'}|${error ?? ''}`}</output>;
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

describe('useOptimisticPatches', () => {
  it('shows the edit at once and keeps the server row when the save succeeds', async () => {
    view = await mount(<Probe />, fakeServices());
    const save = deferred<Row>();

    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = handle.commit?.('a', { name: 'Sam' }, () => save.promise) ?? done;
    });
    expect(view.container.textContent).toBe('Sam|');

    await act(async () => {
      save.resolve({ id: 'a', name: 'Sam R.' });
      expect(await done).toBe(true);
    });
    expect(view.container.textContent).toBe('Sam R.|');
  });

  it('puts the previous value back and reports the error when the save fails', async () => {
    view = await mount(<Probe />, fakeServices());
    await act(async () => {
      await handle.commit?.('a', { name: 'Ana' }, () => Promise.resolve({ id: 'a', name: 'Ana' }));
    });

    await act(async () => {
      const ok = await handle.commit?.('a', { name: 'Bea' }, () => Promise.reject(new Error('offline')));
      expect(ok).toBe(false);
    });

    expect(view.container.textContent).toBe('Ana|offline');
  });
});
