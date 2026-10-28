// Productions list hooks: the list itself, starting a new production (and the New production
// form both apps draw), renaming one, and which Studio list (Shorts or Productions) is shown, remembered for
// the session.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { BRIEF_PRESETS, DEFAULT_TARGET_S } from '../core/production-view';
import type { Aspect, CreateProductionRequest, ProductionFormat, ProductionListItem } from '../services/api/types';
import type { StudioView } from '../services/studio-view';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** Productions list poll interval, ms (a plan in flight changes its row). */
export const PRODUCTIONS_POLL_MS = 5000;

/**
 * Every production, newest first.
 * @returns The polled list and `refresh`.
 */
export function useProductions(): { state: Polled<ProductionListItem[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listProductions(signal), [api]);
  return usePolled(load, { intervalMs: PRODUCTIONS_POLL_MS });
}

/**
 * Starts planning a production; a failure raises a toast.
 * @returns `create`, resolving the new production id or null, and whether it runs.
 */
export function useCreateProduction(): {
  create: (request: CreateProductionRequest) => Promise<string | null>;
  isCreating: boolean;
} {
  const { api, toasts } = useServices();
  const [isCreating, setCreating] = useState(false);
  const create = useCallback(
    async (request: CreateProductionRequest) => {
      setCreating(true);
      try {
        return (await api.createProduction(request)).production_id;
      } catch (error) {
        toasts.error('Could not start planning', error);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [api, toasts],
  );
  return { create, isCreating };
}

/** The New production form's state and its "Plan my shots". */
export interface NewProductionForm {
  brief: string;
  setBrief: (brief: string) => void;
  format: ProductionFormat;
  setFormat: (format: ProductionFormat) => void;
  aspect: Aspect;
  setAspect: (aspect: Aspect) => void;
  blur: boolean;
  setBlur: (blur: boolean) => void;
  /** A brief is written and no plan is starting. */
  canPlan: boolean;
  isCreating: boolean;
  /** Starts the plan and opens the new production in place of the form. */
  plan: () => void;
}

/**
 * The New production form: the brief (the first preset), Story, 4:5 and blur on to start.
 * @returns The form.
 */
export function useNewProductionForm(): NewProductionForm {
  const navigate = useNavigate();
  const { create, isCreating } = useCreateProduction();
  const [brief, setBrief] = useState(BRIEF_PRESETS[0]?.brief ?? '');
  const [format, setFormat] = useState<ProductionFormat>('story');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [blur, setBlur] = useState(true);
  const plan = () => {
    void create({ brief: brief.trim(), format, aspect, target_s: DEFAULT_TARGET_S[format], blur_bystanders: blur }).then((id) => {
      if (id !== null) void navigate(`/productions/${encodeURIComponent(id)}`, { replace: true });
    });
  };
  return {
    brief,
    setBrief,
    format,
    setFormat,
    aspect,
    setAspect,
    blur,
    setBlur,
    canPlan: brief.trim() !== '' && !isCreating,
    isCreating,
    plan,
  };
}

/**
 * Finds a production's story short (the list rows do not carry it), for "Open its short".
 * @returns `find`, resolving the short id, or null when there is none or the lookup failed
 *   (a failure raises a toast).
 */
export function useStoryShortLookup(): (productionId: string) => Promise<string | null> {
  const { api, toasts } = useServices();
  return useCallback(
    async (productionId: string) => {
      try {
        return (await api.getProduction(productionId)).production.short_id;
      } catch (error) {
        toasts.error('Could not open its short', error);
        return null;
      }
    },
    [api, toasts],
  );
}

/** Renaming a production. */
export interface RenameProduction {
  /** Stores the new title; resolves true on success. */
  rename: (productionId: string, title: string) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * Rename production…; a failure raises a toast.
 * @param onRenamed - Called after a rename succeeds, to reload what shows the title.
 * @returns `rename` and whether it runs.
 */
export function useRenameProduction(onRenamed: () => void): RenameProduction {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);
  const rename = useCallback(
    async (productionId: string, title: string) => {
      setSaving(true);
      try {
        await api.renameProduction(productionId, title);
        onRenamed();
        return true;
      } catch (error) {
        toasts.error('Could not rename the production', error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, onRenamed, toasts],
  );
  return { rename, isSaving };
}

/** A production's key art actions. */
export interface ProductionArtActions {
  /** Draws new key art; resolves true when it started. */
  newArt: (productionId: string) => Promise<boolean>;
  /** Adds the key art as a cover to every export of the production's story; resolves true on success. */
  useAsCover: (productionId: string) => Promise<boolean>;
}

/**
 * New art and Use as cover; a failure raises a toast, Use as cover says where the cover went.
 * @param onChanged - Called after either succeeds, to reload what shows the art.
 * @returns The actions.
 */
export function useProductionArt(onChanged: () => void): ProductionArtActions {
  const { api, toasts } = useServices();
  const newArt = useCallback(
    async (productionId: string) => {
      try {
        await api.newProductionArt(productionId);
        onChanged();
        return true;
      } catch (error) {
        toasts.error('Could not draw new art', error);
        return false;
      }
    },
    [api, onChanged, toasts],
  );
  const useAsCover = useCallback(
    async (productionId: string) => {
      try {
        const { platforms } = await api.useArtAsCover(productionId);
        if (platforms.length === 0) toasts.info('No room for another cover', 'Every platform already has 9 covers.');
        else toasts.info('Key art added as a cover', 'Pick it on the Publish screen of the story.');
        onChanged();
        return true;
      } catch (error) {
        toasts.error('Could not use the art as a cover', error);
        return false;
      }
    },
    [api, onChanged, toasts],
  );
  return { newArt, useAsCover };
}

/**
 * The Studio's list (Shorts by default), remembered for the session.
 * @returns The view and `setView`.
 */
export function useStudioView(): { view: StudioView; setView: (view: StudioView) => void } {
  const { studioView } = useServices();
  const [view, setState] = useState<StudioView>(() => studioView.read());
  const setView = useCallback(
    (next: StudioView) => {
      studioView.write(next);
      setState(next);
    },
    [studioView],
  );
  return { view, setView };
}
