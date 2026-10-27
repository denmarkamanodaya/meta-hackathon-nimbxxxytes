// Hooks for the Mac app's native features: the live sync status, the Sync page's actions, the
// per-clip "Make available offline" switch, the Short page's editing-app actions and badges, the
// saved server for the Sync page, and the native upload picker. Used only by
// desktop UI (components/desktop/, pages/OnThisMacPage), which the PWA never mounts.
import { useCallback, useEffect, useState } from 'react';
import type { SyncStatus } from '../core/desktop-sync';
import type { DesktopBridge } from '../core/ports/desktop-bridge';
import { useServices } from './services-context';

/** The sync status as the UI shows it. */
export type SyncStatusState =
  | { status: 'loading' }
  | { status: 'ready'; data: SyncStatus }
  | { status: 'error'; error: unknown };

function useBridge(): DesktopBridge {
  const { desktop } = useServices();
  if (desktop === null) throw new Error('desktop hook used outside the Mac app (a wiring bug)');
  return desktop;
}

/**
 * Loads the sync status, then follows every pushed update.
 * @returns The state and `reload`, which asks the native side again.
 */
export function useSyncStatus(): { state: SyncStatusState; reload: () => void } {
  const bridge = useBridge();
  const [state, setState] = useState<SyncStatusState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let isLive = true;
    const show = (data: SyncStatus) => {
      if (isLive) setState({ status: 'ready', data });
    };
    const stop = bridge.onSyncStatus(show);
    bridge.syncStatus().then(show, (error: unknown) => {
      if (isLive) setState((current) => (current.status === 'ready' ? current : { status: 'error', error }));
    });
    return () => {
      isLive = false;
      stop();
    };
  }, [bridge, attempt]);
  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  return { state, reload };
}

/**
 * The Sync panel's actions. Failures show a toast; the pushed status shows the outcome.
 * @returns The actions and whether sign-out is running.
 */
export function useSyncActions() {
  const bridge = useBridge();
  const { api, session, searchCache, toasts } = useServices();
  const [isSigningOut, setSigningOut] = useState(false);
  const run = useCallback(
    (title: string, action: () => Promise<void>) => {
      action().catch((error: unknown) => {
        toasts.error(title, error);
      });
    },
    [toasts],
  );
  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      try {
        await api.signOut();
      } catch {
        // Recovers: signing out of the Mac app must work offline; the Keychain session is cleared
        // below either way and the server session expires by itself.
      }
      await bridge.signOut();
      searchCache.clear();
      session.lock();
    } catch (error) {
      toasts.error('Could not sign out', error);
    } finally {
      setSigningOut(false);
    }
  }, [api, bridge, searchCache, session, toasts]);
  return {
    syncNow: () => {
      run('Could not start a sync', () => bridge.syncNow());
    },
    revealFolder: () => {
      run('Could not open the folder', () => bridge.reveal({ kind: 'folder' }));
    },
    signOut,
    isSigningOut,
  };
}

/**
 * Keeps a clip on this Mac or lets it go back to the cloud (the Library's right-click menu); the
 * pushed status shows the outcome, a failure shows a toast.
 * @returns The setter.
 */
export function useKeepOffline(): (clipId: string, offline: boolean) => void {
  const bridge = useBridge();
  const { toasts } = useServices();
  return useCallback(
    (clipId: string, offline: boolean) => {
      bridge.setOffline(clipId, offline).catch((error: unknown) => {
        toasts.error(offline ? 'Could not keep the clip on this Mac' : 'Could not free the clip', error);
      });
    },
    [bridge, toasts],
  );
}

/**
 * The clip's "Make available offline" switch: pinned state from the sync status, flipped
 * optimistically and put back when the native call fails.
 * @param clipId - The clip.
 * @returns `isPinned` (null while the status loads), `isSaving` and `setPinned`.
 */
export function useClipOffline(clipId: string) {
  const bridge = useBridge();
  const { toasts } = useServices();
  const { state } = useSyncStatus();
  const [override, setOverride] = useState<boolean | null>(null);
  const [isSaving, setSaving] = useState(false);
  const fromStatus = state.status === 'ready' ? state.data.pinnedClipIds.includes(clipId) : null;
  const setPinned = useCallback(
    async (offline: boolean) => {
      setOverride(offline);
      setSaving(true);
      try {
        await bridge.setOffline(clipId, offline);
      } catch (error) {
        setOverride(null);
        toasts.error(offline ? 'Could not make the clip available offline' : 'Could not free the original', error);
      } finally {
        setSaving(false);
      }
    },
    [bridge, clipId, toasts],
  );
  return { isPinned: override ?? fromStatus, isSaving, setPinned };
}

/**
 * The Short page's editing-app actions.
 * @param shortId - The short.
 * @returns Open in Final Cut Pro, reveal the FCPXML or the render, whether opening runs, and
 *   whether the last open fell back to Finder (Final Cut Pro not installed).
 */
export function useNleActions(shortId: string) {
  const bridge = useBridge();
  const { toasts } = useServices();
  const [isOpening, setOpening] = useState(false);
  const [isFinderFallback, setFinderFallback] = useState(false);
  const openInFinalCut = useCallback(async () => {
    setOpening(true);
    try {
      const opened = await bridge.openInEditor(shortId);
      setFinderFallback(opened.openedWith === 'finder');
    } catch (error) {
      toasts.error('Could not open the timeline', error);
    } finally {
      setOpening(false);
    }
  }, [bridge, shortId, toasts]);
  const reveal = (kind: 'fcpxml' | 'render') => {
    bridge.reveal({ kind, shortId }).catch((error: unknown) => {
      toasts.error(kind === 'fcpxml' ? 'Could not show the timeline' : 'Could not show the render', error);
    });
  };
  return {
    openInFinalCut,
    revealFcpxml: () => {
      reveal('fcpxml');
    },
    revealRender: () => {
      reveal('render');
    },
    isOpening,
    isFinderFallback,
  };
}

/**
 * Which of the given clips have their original fully on disk (`media_lookup`), for the Short
 * page's Original / Proxy badges.
 * @param clipIds - Clip ids; must be a stable array (memoised by the caller).
 * @returns Clip id to true (original on disk) or false; missing while the lookup runs.
 */
export function useOriginalsOnDisk(clipIds: readonly string[]): ReadonlyMap<string, boolean> {
  const bridge = useBridge();
  const [onDisk, setOnDisk] = useState<ReadonlyMap<string, boolean>>(new Map());
  useEffect(() => {
    let isLive = true;
    void Promise.all(
      clipIds.map((id) =>
        bridge.isOnDisk('original', id).then(
          (isLocal) => [id, isLocal] as const,
          () => [id, false] as const, // Recovers: an unknown file shows as Proxy, the safe claim.
        ),
      ),
    ).then((pairs) => {
      if (isLive) setOnDisk(new Map(pairs));
    });
    return () => {
      isLive = false;
    };
  }, [bridge, clipIds]);
  return onDisk;
}

/**
 * The Mac Upload page's picker: opens the native file dialog; the native engine uploads and
 * reports progress in the sync status transfers.
 * @returns `pick` and whether the dialog is open.
 */
export function usePickAndUpload() {
  const bridge = useBridge();
  const { toasts } = useServices();
  const [isPicking, setPicking] = useState(false);
  const pick = useCallback(async () => {
    setPicking(true);
    try {
      const queued = await bridge.pickAndUpload();
      if (queued > 0) toasts.info('Uploading', `${String(queued)} ${queued === 1 ? 'clip' : 'clips'} queued.`);
    } catch (error) {
      toasts.error('Could not start the upload', error);
    } finally {
      setPicking(false);
    }
  }, [bridge, toasts]);
  return { pick, isPicking };
}

/**
 * The server URL the app talks to, for the Sync page's "Can't reach" line and server row.
 * @returns The URL, null when none is saved, or undefined while it loads (or could not be read).
 */
export function useServerUrl(): string | null | undefined {
  const bridge = useBridge();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let isLive = true;
    bridge.server().then(
      (saved) => {
        if (isLive) setUrl(saved);
      },
      () => {
        // Recovers: the page then names "your server" instead of the address.
        if (isLive) setUrl(null);
      },
    );
    return () => {
      isLive = false;
    };
  }, [bridge]);
  return url;
}
