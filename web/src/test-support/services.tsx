// Test doubles for the services context and a tiny renderer for hook tests (no Testing Library).
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import { createRecentQueryStore } from '../services/search/recent-store';
import { createSearchCache } from '../services/search/search-cache';
import { createSessionStore } from '../services/session/session-store';
import { createInstallHintStore } from '../services/device';
import { createDismissedMatches } from '../services/people/dismissed-matches';
import { createToastStore } from '../services/toast/toast-store';
import { cloudMediaResolver } from '../services/media/cloud-media';
import type { UploadQueue } from '../services/upload/queue';
import { createStudioViewStore } from '../services/studio-view';
import { createGalleryPrefsStore } from '../services/gallery-prefs';
import { ServicesContext, type Services } from '../hooks/services-context';

/** An ApiClient whose every method rejects until a test stubs it. */
export function fakeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const unstubbed = () => Promise.reject(new Error('not stubbed'));
  return {
    getHealth: vi.fn(unstubbed),
    createSession: vi.fn(unstubbed),
    getSession: vi.fn(unstubbed),
    signOut: vi.fn(unstubbed),
    getCosts: vi.fn(unstubbed),
    getStorage: vi.fn(unstubbed),
    getPeopleOverview: vi.fn(unstubbed),
    listShorts: vi.fn(unstubbed),
    checkUpload: vi.fn(unstubbed),
    createUpload: vi.fn(unstubbed),
    presignParts: vi.fn(unstubbed),
    completeUpload: vi.fn(unstubbed),
    listClips: vi.fn(unstubbed),
    listProjectClips: vi.fn(unstubbed),
    listProjects: vi.fn(unstubbed),
    createProject: vi.fn(unstubbed),
    updateProject: vi.fn(unstubbed),
    deleteProject: vi.fn(unstubbed),
    addProjectClips: vi.fn(unstubbed),
    removeProjectClip: vi.fn(unstubbed),
    getClip: vi.fn(unstubbed),
    deleteClip: vi.fn(unstubbed),
    search: vi.fn(unstubbed),
    searchStream: vi.fn(unstubbed),
    listPeople: vi.fn(unstubbed),
    updateTrack: vi.fn(unstubbed),
    updateSpeaker: vi.fn(unstubbed),
    nameTracks: vi.fn(unstubbed),
    getSettings: vi.fn(unstubbed),
    updateSettings: vi.fn(unstubbed),
    createShort: vi.fn(unstubbed),
    getShort: vi.fn(unstubbed),
    saveTimeline: vi.fn(unstubbed),
    renderShort: vi.fn(unstubbed),
    deleteShort: vi.fn(unstubbed),
    getDownload: vi.fn(unstubbed),
    listProductions: vi.fn(unstubbed),
    createProduction: vi.fn(unstubbed),
    getProduction: vi.fn(unstubbed),
    recheckCoverage: vi.fn(unstubbed),
    retryProduction: vi.fn(unstubbed),
    cutProduction: vi.fn(unstubbed),
    deleteProduction: vi.fn(unstubbed),
    renameProduction: vi.fn(unstubbed),
    getShortProduction: vi.fn(unstubbed),
    getFinish: vi.fn(unstubbed),
    saveFinish: vi.fn(unstubbed),
    getBrand: vi.fn(unstubbed),
    saveBrand: vi.fn(unstubbed),
    createBrandUpload: vi.fn(unstubbed),
    createExports: vi.fn(unstubbed),
    listExports: vi.fn(unstubbed),
    editExport: vi.fn(unstubbed),
    moreCovers: vi.fn(unstubbed),
    redrawCover: vi.fn(unstubbed),
    redrawShotBoard: vi.fn(unstubbed),
    newProductionArt: vi.fn(unstubbed),
    useArtAsCover: vi.fn(unstubbed),
    newProjectArt: vi.fn(unstubbed),
    findThis: vi.fn(unstubbed),
    cutOut: vi.fn(unstubbed),
    getReframe: vi.fn(unstubbed),
    startReframe: vi.fn(unstubbed),
    setShotSubject: vi.fn(unstubbed),
    startGuide: vi.fn(unstubbed),
    listGuides: vi.fn(unstubbed),
    getGuide: vi.fn(unstubbed),
    editGuideStep: vi.fn(unstubbed),
    renameGuide: vi.fn(unstubbed),
    deleteGuide: vi.fn(unstubbed),
    ...overrides,
  };
}

/** Full services value with fakes; override what the test exercises. */
export function fakeServices(overrides: Partial<Services> = {}): Services {
  const uploads: UploadQueue = {
    subscribe: () => () => undefined,
    getSnapshot: () => [],
    add: vi.fn(),
    retry: vi.fn(),
  };
  return {
    api: fakeApi(),
    session: createSessionStore(),
    uploads,
    wakeLock: { setActive: vi.fn(), dispose: vi.fn() },
    events: () => () => undefined,
    shortSteps: () => () => undefined,
    productionSteps: () => () => undefined,
    exportSteps: () => () => undefined,
    putFile: vi.fn(() => Promise.resolve('"etag"')),
    studioView: createStudioViewStore(null),
    galleryPrefs: createGalleryPrefsStore(null),
    recents: createRecentQueryStore(null),
    searchCache: createSearchCache(10),
    shareVideo: vi.fn(() => Promise.resolve('unsupported' as const)),
    copyText: vi.fn(() => Promise.resolve(true)),
    stepAudio: { play: vi.fn(), stop: vi.fn() },
    copyImage: vi.fn(() => Promise.resolve('image' as const)),
    toasts: createToastStore(() => undefined),
    device: { userAgent: 'test', maxTouchPoints: 0, isStandalone: false },
    installHint: createInstallHintStore(null),
    dismissedMatches: createDismissedMatches(),
    media: cloudMediaResolver,
    desktop: null,
    appearance: null,
    macDownloadUrl: null,
    ...overrides,
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A mounted tree inside the services provider. */
export interface Mounted {
  container: HTMLDivElement;
  /** Renders a new tree (for example new props) into the same root. */
  rerender(node: ReactNode): void;
  unmount(): void;
}

/**
 * Renders `node` inside `ServicesContext` and lets pending promises settle.
 * @param node - Usually a probe component that calls the hook under test.
 * @param services - The services value.
 * @returns The container and an unmount function.
 */
export async function mount(node: ReactNode, services: Services): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.append(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(<ServicesContext value={services}>{node}</ServicesContext>);
    await Promise.resolve();
  });
  return {
    container,
    rerender: (next) => {
      act(() => {
        root.render(<ServicesContext value={services}>{next}</ServicesContext>);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}
