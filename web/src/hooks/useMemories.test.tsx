// Starting a session POSTs exactly the person or the clip and the viewer, then opens the session's
// page; a failed start stays put with a toast.
import { act, useEffect } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { useStartMemory, type StartMemory } from './useMemories';

let view: Mounted | null = null;

afterEach(() => {
  view?.unmount();
  view = null;
});

const box: { start: StartMemory | null } = { start: null };

function Probe() {
  const start = useStartMemory();
  useEffect(() => {
    box.start = start;
  });
  return null;
}

async function open(api: Partial<ApiClient>) {
  const services = fakeServices({ api: fakeApi(api) });
  view = await mount(
    <MemoryRouter initialEntries={['/memory-lane']}>
      <Routes>
        <Route path="/memory-lane" element={<Probe />} />
        <Route path="/memory-lane/:id" element={<output>session page</output>} />
      </Routes>
    </MemoryRouter>,
    services,
  );
  return services;
}

describe('useStartMemory', () => {
  it('POSTs the person and viewer with a null clip, then opens the session', async () => {
    const createMemory = vi.fn<ApiClient['createMemory']>().mockResolvedValue({ memory_id: 'mem 1', status: 'making' });
    await open({ createMemory });

    let id: string | null = null;
    await act(async () => {
      id = (await box.start?.start({ person_id: 'p_kristoff', clip_id: null, viewer_id: 'p_eric' })) ?? null;
    });

    expect(createMemory).toHaveBeenCalledWith({ person_id: 'p_kristoff', clip_id: null, viewer_id: 'p_eric' });
    expect(id).toBe('mem 1');
    expect(view?.container.textContent).toBe('session page');
  });

  it('a failed start resolves null, raises a toast and stays on the page', async () => {
    const createMemory = vi.fn<ApiClient['createMemory']>().mockRejectedValue(new Error('offline'));
    const services = await open({ createMemory });
    const error = vi.spyOn(services.toasts, 'error');

    let id: string | null = 'x';
    await act(async () => {
      id = (await box.start?.start({ person_id: null, clip_id: 'c1', viewer_id: null })) ?? null;
    });

    expect(id).toBeNull();
    expect(error).toHaveBeenCalledWith('Could not start the session', expect.any(Error));
    expect(view?.container.textContent).toBe('');
  });
});
