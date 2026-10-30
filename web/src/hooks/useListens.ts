// iListen hooks: the list, one listen (polled while it listens), adding a file (register, then send
// the file itself through the API, which starts the job), listening to a clip, the output language (the
// remembered choice, and changing it on a finished listen), renaming and deleting. Each failure
// raises a toast.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeError } from '../core/error-text';
import { ILISTEN_COPY, isListenBusy, listenFileProblem, listenType } from '../core/ilisten/listens';
import type { ListenDetail, ListenSummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** The iListen list's route. */
export const ILISTEN_PATH = '/ilisten';

/** The route of one listen. */
export const listenPath = (listenId: string): string => `${ILISTEN_PATH}/${encodeURIComponent(listenId)}`;

/** List poll interval, ms (a listen at work changes its row). */
export const LISTENS_POLL_MS = 5000;
/** One listen's poll interval while it listens, ms. */
export const LISTEN_POLL_MS = 1500;

/**
 * Every listen, newest first as the API sends them.
 * @returns The polled list and `refresh`.
 */
export function useListens(): { state: Polled<ListenSummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listListens(signal), [api]);
  return usePolled(load, { intervalMs: LISTENS_POLL_MS });
}

const keepPollingListen = (listen: ListenDetail) => isListenBusy(listen.status);

/**
 * One listen, polled until it is ready or failed.
 * @param listenId - The listen.
 * @returns The polled listen and `refresh`.
 */
export function useListen(listenId: string): { state: Polled<ListenDetail>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getListen(listenId, signal), [api, listenId]);
  return usePolled(load, { intervalMs: LISTEN_POLL_MS, keepPolling: keepPollingListen });
}

/** The output language new listens are made in. */
export interface ListenTarget {
  target: string;
  /** Picks and remembers it. */
  setTarget: (target: string) => void;
}

/**
 * The "Summary in" choice: starts at the remembered language (English at first) and remembers
 * each pick.
 * @returns The language and `setTarget`.
 */
export function useListenTarget(): ListenTarget {
  const { listenPrefs } = useServices();
  const [target, setState] = useState(listenPrefs.readTarget);
  const setTarget = useCallback(
    (next: string) => {
      listenPrefs.writeTarget(next);
      setState(next);
    },
    [listenPrefs],
  );
  return { target, setTarget };
}

/** Adding a recording. */
export interface AddListen {
  /** Uploads the file and starts the listen; resolves its id, or null (with a toast). */
  add: (file: File, target: string) => Promise<string | null>;
  isAdding: boolean;
  /** Why the last add failed, for the page to show beside the toast; null after a success. */
  error: string | null;
}

/**
 * Choose a file / drop a file: registers the listen, then sends the file itself through the API
 * with the type the API was told; the server stores it and starts the job (as iRead's source does,
 * so no `complete` call follows). A file over this build's cap (50 MB on the Mac) never leaves the
 * device, and the picker says why. When the file does not get there,
 * the empty listen is deleted again so no row waits on a file that never comes.
 * @returns `add`, whether one runs and the last failure.
 */
export function useAddListen(): AddListen {
  const { api, toasts, listenLimit } = useServices();
  const [isAdding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(
    async (file: File, target: string) => {
      const problem = listenFileProblem(file, listenLimit);
      const type = listenType(file.name, file.type);
      if (problem !== null || type === null) {
        const why = problem ?? 'Choose a sound file or a video.';
        setError(why);
        toasts.info('This file cannot be listened to', why);
        return null;
      }
      setAdding(true);
      setError(null);
      let createdId: string | null = null;
      try {
        const created = await api.createListen({ filename: file.name, content_type: type, size_bytes: file.size, clip_id: null, target });
        createdId = created.listen_id;
        // The body must carry the type the API was told; a picker may have left it empty.
        const body = file.type === type ? file : new Blob([file], { type });
        await api.sendListenSource(created.listen_id, body);
        return created.listen_id;
      } catch (thrown) {
        if (createdId !== null) {
          await api.deleteListen(createdId).catch(() => {
            // Recovers: the empty listen stays and can be deleted by hand.
          });
        }
        setError(describeError(thrown).text);
        toasts.error(ILISTEN_COPY.addFailed, thrown);
        return null;
      } finally {
        setAdding(false);
      }
    },
    [api, listenLimit, toasts],
  );
  return { add, isAdding, error };
}

/** Listening to a clip. */
export interface ListenToClip {
  /** Starts a listen of the clip in the remembered language and opens it. */
  start: (clipId: string) => void;
  isStarting: boolean;
}

/**
 * "Listen" on a clip: the clip's stored audio and transcript are reused, so the listen starts at
 * once; its page opens with the progress list.
 * @returns `start` and whether it runs.
 */
export function useListenToClip(): ListenToClip {
  const { api, toasts, listenPrefs } = useServices();
  const navigate = useNavigate();
  const [isStarting, setStarting] = useState(false);
  const start = useCallback(
    (clipId: string) => {
      setStarting(true);
      api
        .createListen({ filename: null, content_type: null, size_bytes: null, clip_id: clipId, target: listenPrefs.readTarget() })
        .then(
          (created) => {
            void navigate(listenPath(created.listen_id));
          },
          (error: unknown) => {
            toasts.error('Could not listen to this clip', error);
          },
        )
        .finally(() => {
          setStarting(false);
        });
    },
    [api, listenPrefs, navigate, toasts],
  );
  return { start, isStarting };
}

/** Changing a finished listen's output language. */
export interface ChangeListenLanguage {
  /** Asks for the summary again in `target`; resolves true once the API took it. */
  change: (listenId: string, target: string) => Promise<boolean>;
  isChanging: boolean;
}

/**
 * The summary's language select: the transcript stays; understand, check and voice run again. The
 * pick is also remembered for new listens.
 * @param onChanged - Called after the API took it, to reload the listen (it is listening again).
 * @returns `change` and whether it runs.
 */
export function useChangeListenLanguage(onChanged: () => void): ChangeListenLanguage {
  const { api, toasts, listenPrefs } = useServices();
  const [isChanging, setChanging] = useState(false);
  const change = useCallback(
    async (listenId: string, target: string) => {
      setChanging(true);
      listenPrefs.writeTarget(target);
      try {
        await api.changeListenLanguage(listenId, target);
        onChanged();
        return true;
      } catch (error) {
        toasts.error('Could not change the language', error);
        return false;
      } finally {
        setChanging(false);
      }
    },
    [api, listenPrefs, onChanged, toasts],
  );
  return { change, isChanging };
}

/** Renaming a listen. */
export interface RenameListen {
  rename: (listenId: string, title: string) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * Rename…: PATCHes the title; a failure raises a toast.
 * @param onRenamed - Called after a rename succeeds.
 * @returns `rename` and whether it runs.
 */
export function useRenameListen(onRenamed: () => void): RenameListen {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);
  const rename = useCallback(
    async (listenId: string, title: string) => {
      setSaving(true);
      try {
        await api.renameListen(listenId, title);
        onRenamed();
        return true;
      } catch (error) {
        toasts.error('Could not rename the recording', error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, onRenamed, toasts],
  );
  return { rename, isSaving };
}

/** Deleting a listen. */
export interface DeleteListen {
  remove: (listenId: string) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Delete recording: removes the listen and leaves for the iListen list, replacing it in history.
 * @returns `remove` and whether it runs.
 */
export function useDeleteListen(): DeleteListen {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const remove = useCallback(
    async (listenId: string) => {
      setDeleting(true);
      try {
        await api.deleteListen(listenId);
        void navigate(ILISTEN_PATH, { replace: true });
        return true;
      } catch (error) {
        toasts.error('Could not delete the recording', error);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [api, navigate, toasts],
  );
  return { remove, isDeleting };
}
