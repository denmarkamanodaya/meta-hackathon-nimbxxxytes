// Hooks for the Mac app's native features: the live sync status, the Sync page's actions, the
// per-clip "Make available offline" switch, the Short page's editing-app actions and badges, the
// saved server for the Sync page, and the Gallery's native upload pickers and upload progress. The
// wide-screen PWA draws the same Mac pages in a browser, where there is no native side: there every
// hook is inert (no status, actions do nothing) and the pages hide the Mac-only controls
// (`useIsMacApp`).
import { useAddPhotos } from './usePhotos';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { spaceUsedLabel, type SyncStatus } from '../core/desktop-sync';
import { advanceTally, EMPTY_TALLY, galleryUploads, uploadingLine, type SentTally } from '../core/gallery-uploads';
import type { DesktopBridge } from '../core/ports/desktop-bridge';
import { bytesPerSecond, type RateSample } from '../services/upload/rate';
import { useServices } from './services-context';

/** The sync status as the UI shows it. */
export type SyncStatusState =
  | { status: 'loading' }
  | { status: 'ready'; data: SyncStatus }
  | { status: 'error'; error: unknown };

function useBridge(): DesktopBridge | null {
  return useServices().desktop;
}

/**
 * Whether the page runs inside the Mac app (not the PWA in a browser).
 * @returns True when the native side is there.
 */
export function useIsMacApp(): boolean {
  return useBridge() !== null;
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
    if (bridge === null) return undefined;
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
      await bridge?.signOut();
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
      if (bridge !== null) run('Could not start a sync', () => bridge.syncNow());
    },
    revealFolder: () => {
      if (bridge !== null) run('Could not open the folder', () => bridge.reveal({ kind: 'folder' }));
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
      bridge?.setOffline(clipId, offline).catch((error: unknown) => {
        toasts.error(offline ? 'Could not keep the clip on this Mac' : 'Could not free the clip', error);
      });
    },
    [bridge, toasts],
  );
}

/**
 * "Show in Finder" for a clip: reveals its original in `~/nimbytes`; a failure shows a toast.
 * @returns `reveal(clipId)`.
 */
export function useRevealClip(): (clipId: string) => void {
  const bridge = useBridge();
  const { toasts } = useServices();
  return useCallback(
    (clipId: string) => {
      bridge?.reveal({ kind: 'original', clipId }).catch((error: unknown) => {
        toasts.error('Could not show the clip in Finder', error);
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
      if (bridge === null) return;
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
    if (bridge === null) return;
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
    bridge?.reveal({ kind, shortId }).catch((error: unknown) => {
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
    if (bridge === null) return undefined;
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
 * The Gallery's Upload split button: Upload opens the native file dialog, "Upload a folder…" the
 * folder dialog. The native engine uploads the videos, and the Gallery's tiles and header pill show
 * the progress, so a pick says nothing more (a cancelled dialog queues nothing); a failure shows a
 * toast. Picked photos go up through the photo queue (the Gallery's "Uploading 12 photos" card),
 * each read from the native side only when its upload starts, so at most three are in memory.
 * @returns `pick` and `pickFolder` (each resolves how many files it queued: 0 when cancelled or
 * failed) and whether a dialog is open.
 */
export function usePickAndUpload() {
  const bridge = useBridge();
  const { toasts } = useServices();
  const photos = useAddPhotos();
  const [isPicking, setPicking] = useState(false);
  const run = useCallback(
    async (open: () => Promise<number>): Promise<number> => {
      setPicking(true);
      try {
        return await open();
      } catch (error) {
        toasts.error('Could not start the upload', error);
        return 0;
      } finally {
        setPicking(false);
      }
    },
    [toasts],
  );
  return {
    pick: () =>
      bridge === null
        ? Promise.resolve(0)
        : run(async () => {
            const picked = await bridge.pickAndUpload();
            // Each photo is read from the native side only when its upload starts (three at a time).
            void photos.addSources(picked.images.map((image) => ({ name: image.name, open: () => bridge.readPickedImage(image) })));
            return picked.queued + picked.images.length;
          }),
    pickFolder: () => (bridge === null ? Promise.resolve(0) : run(() => bridge.pickFolderAndUpload())),
    isPicking,
  };
}

/** How far back the upload speed looks, in ms. */
const UPLOAD_RATE_WINDOW_MS = 10_000;

/** The running tally of bytes sent, its recent readings and the speed they give. */
interface UploadPace {
  tally: SentTally;
  samples: RateSample[];
  bytesPerSecond: number | null;
}

const NO_PACE: UploadPace = { tally: EMPTY_TALLY, samples: [], bytesPerSecond: null };

/** The pace after one more status, read at `atMs`. */
function nextPace(pace: UploadPace, status: SyncStatus, atMs: number): UploadPace {
  const tally = advanceTally(pace.tally, status.transfers);
  if (tally === EMPTY_TALLY) return NO_PACE;
  const samples = [...pace.samples, { atMs, bytes: tally.sent }].filter((s) => atMs - s.atMs <= UPLOAD_RATE_WINDOW_MS);
  return { tally, samples, bytesPerSecond: bytesPerSecond(samples, atMs, UPLOAD_RATE_WINDOW_MS) };
}

/**
 * The Gallery's uploads: the tiles (uploading first), the header pill line with the time left
 * from the speed of the last few seconds, and cancel. A cancelled upload hides at once; the native
 * side drops it after the part in flight. A failed cancel brings it back with a toast.
 * @returns `uploads`, `line` (null when nothing is uploading) and `cancel(transferId)`.
 */
export function useGalleryUploads() {
  const bridge = useBridge();
  const { toasts } = useServices();
  const { state } = useSyncStatus();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [pace, setPace] = useState<UploadPace>(NO_PACE);
  useEffect(
    () =>
      bridge?.onSyncStatus((status) => {
        const atMs = performance.now();
        setPace((current) => nextPace(current, status, atMs));
        // A cancelled id that left the transfers may come back as a new upload of the same file.
        setHidden((current) => {
          const ids = new Set(status.transfers.map((t) => t.id));
          return [...current].every((id) => ids.has(id)) ? current : new Set([...current].filter((id) => ids.has(id)));
        });
      }),
    [bridge],
  );
  const sync = state.status === 'ready' ? state.data : null;
  const uploads = useMemo(() => galleryUploads(sync, hidden), [sync, hidden]);
  const cancel = useCallback(
    (transferId: string) => {
      setHidden((current) => new Set([...current, transferId]));
      bridge?.cancelUpload(transferId).catch((error: unknown) => {
        setHidden((current) => new Set([...current].filter((id) => id !== transferId)));
        toasts.error('Could not cancel the upload', error);
      });
    },
    [bridge, toasts],
  );
  return { uploads, line: uploadingLine(uploads, pace.bytesPerSecond), cancel };
}

/**
 * The server URL the app talks to, for the Sync page's "Can't reach" line and server row.
 * @returns The URL, null when none is saved, or undefined while it loads (or could not be read).
 */
export function useServerUrl(): string | null | undefined {
  const bridge = useBridge();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (bridge === null) return undefined;
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

/**
 * The app's version for Settings › Account.
 * @returns The version, or null while it loads or when it could not be read.
 */
export function useAppVersion(): string | null {
  const bridge = useBridge();
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    if (bridge === null) return undefined;
    let isLive = true;
    bridge.appVersion().then(
      (answer) => {
        if (isLive) setVersion(answer);
      },
      () => {
        // Recovers: the row then shows the app name alone.
      },
    );
    return () => {
      isLive = false;
    };
  }, [bridge]);
  return version;
}

/**
 * Sets "Most space to use" (the drive cache cap, GB); the pushed status shows the new cap, a
 * failure shows a toast.
 * @returns The setter.
 */
export function useCacheBudget(): (gb: number) => void {
  const bridge = useBridge();
  const { toasts } = useServices();
  return useCallback(
    (gb: number) => {
      bridge?.setCacheBudget(gb).catch((error: unknown) => {
        toasts.error('Could not change the space limit', error);
      });
    },
    [bridge, toasts],
  );
}

/**
 * Settings › General "Open at login": read from the native login item, flipped optimistically
 * and put back when the native call fails.
 * @returns `isEnabled` (null while it loads or when it could not be read), `isSaving` and `setEnabled`.
 */
export function useOpenAtLogin() {
  const bridge = useBridge();
  const { toasts } = useServices();
  const [isEnabled, setIsEnabled] = useState<boolean | null>(null);
  const [isSaving, setSaving] = useState(false);
  useEffect(() => {
    if (bridge === null) return undefined;
    let isLive = true;
    bridge.loginEnabled().then(
      (enabled) => {
        if (isLive) setIsEnabled(enabled);
      },
      () => {
        // Recovers: the switch stays disabled when the login item can't be read.
      },
    );
    return () => {
      isLive = false;
    };
  }, [bridge]);
  const setEnabled = useCallback(
    async (enabled: boolean) => {
      if (bridge === null) return;
      setIsEnabled(enabled);
      setSaving(true);
      try {
        await bridge.setLoginEnabled(enabled);
      } catch (error) {
        setIsEnabled(!enabled);
        toasts.error(enabled ? 'Could not open nimbytes at login' : 'Could not stop opening at login', error);
      } finally {
        setSaving(false);
      }
    },
    [bridge, toasts],
  );
  return { isEnabled, isSaving, setEnabled };
}

/**
 * "Free up space now": frees the drive cache (kept-offline clips and files being read stay),
 * then says how much was freed and calls `onFreed` so the page reloads the sync status.
 * @param onFreed - Called after a successful free.
 * @returns `freeUpSpace` and whether it runs.
 */
export function useFreeUpSpace(onFreed: () => void) {
  const bridge = useBridge();
  const { toasts } = useServices();
  const [isFreeing, setFreeing] = useState(false);
  const freeUpSpace = useCallback(async () => {
    if (bridge === null) return;
    setFreeing(true);
    try {
      const bytes = await bridge.freeUpSpace();
      toasts.info(bytes > 0 ? `Freed ${spaceUsedLabel(bytes)}` : 'Nothing to free', '');
      onFreed();
    } catch (error) {
      toasts.error('Could not free up space', error);
    } finally {
      setFreeing(false);
    }
  }, [bridge, toasts, onFreed]);
  return { freeUpSpace, isFreeing };
}
