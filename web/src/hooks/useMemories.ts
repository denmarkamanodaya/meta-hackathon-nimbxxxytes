// Memory Lane hooks: the past sessions, one session (polled while it is made) and starting one
// (POST, then open its page on the making screen). Each failure raises a toast.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { isMemoryBusy, MEMORY_COPY } from '../core/memory-lane/memories';
import type { CreateMemoryRequest, MemoryDetail, MemorySummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** The Memory Lane start page's route. */
export const MEMORY_LANE_PATH = '/memory-lane';

/** The route of one session. */
export const memoryPath = (memoryId: string): string => `${MEMORY_LANE_PATH}/${encodeURIComponent(memoryId)}`;

/** List poll interval, ms (a session being made changes its row). */
export const MEMORIES_POLL_MS = 5000;
/** One session's poll interval while it is made, ms. */
export const MEMORY_POLL_MS = 1500;

/**
 * Every session, newest first as the API sends them.
 * @returns The polled list and `refresh`.
 */
export function useMemories(): { state: Polled<MemorySummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listMemories(signal), [api]);
  return usePolled(load, { intervalMs: MEMORIES_POLL_MS });
}

const keepPollingMemory = (memory: MemoryDetail) => isMemoryBusy(memory.summary.status);

/**
 * One session, polled until it is ready or failed.
 * @param memoryId - The session.
 * @returns The polled session and `refresh`.
 */
export function useMemory(memoryId: string): { state: Polled<MemoryDetail>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getMemory(memoryId, signal), [api, memoryId]);
  return usePolled(load, { intervalMs: MEMORY_POLL_MS, keepPolling: keepPollingMemory });
}

/** Starting a session. */
export interface StartMemory {
  /** Starts it and opens its page; resolves the id, or null (with a toast). */
  start: (request: CreateMemoryRequest) => Promise<string | null>;
  isStarting: boolean;
}

/**
 * Start (and the Ask box's memory_lane): POST /memories with the person or the clip and the
 * viewer, then open the session, which shows the making screen while the job runs.
 * @returns `start` and whether it runs.
 */
export function useStartMemory(): StartMemory {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isStarting, setStarting] = useState(false);
  const start = useCallback(
    async (request: CreateMemoryRequest) => {
      setStarting(true);
      try {
        const created = await api.createMemory(request);
        void navigate(memoryPath(created.memory_id));
        return created.memory_id;
      } catch (error) {
        toasts.error(MEMORY_COPY.startFailed, error);
        return null;
      } finally {
        setStarting(false);
      }
    },
    [api, navigate, toasts],
  );
  return { start, isStarting };
}
