// Mock segment membership of recordings, documents and photos (projects hold them by kind and id,
// as the API's `POST /projects/{id}/items` does). Each kind's mock registers its current ids and the
// fixture's `project_ids`; the Projects mock adds, removes and counts; each kind's views read
// `project_ids` back from here, so `GET /listens` and the project agree.
import type { ProjectItemKind } from '../../services/api/types';

/** The shared membership store. */
export interface ItemMemberships {
  /**
   * Starts a kind: its live ids and the fixture's memberships.
   * @param kind - The kind.
   * @param ids - Its ids as they are now (deleted ones drop out of counts and adds).
   * @param seed - Each fixture row's id and project ids.
   */
  register: (kind: ProjectItemKind, ids: () => string[], seed: readonly { id: string; project_ids: readonly string[] }[]) => void;
  /** The projects an item is in. */
  of: (kind: ProjectItemKind, id: string) => string[];
  /** Whether the item exists now. */
  has: (kind: ProjectItemKind, id: string) => boolean;
  add: (projectId: string, kind: ProjectItemKind, id: string) => void;
  remove: (projectId: string, kind: ProjectItemKind, id: string) => void;
  /** A deleted project leaves every item. */
  dropProject: (projectId: string) => void;
  /** How many items of a kind are in a project. */
  count: (projectId: string, kind: ProjectItemKind) => number;
}

/**
 * Builds the store.
 * @returns An empty store; each kind's mock registers itself.
 */
export function createItemMemberships(): ItemMemberships {
  const live = new Map<ProjectItemKind, () => string[]>();
  const members = new Map<string, string[]>();
  const key = (kind: ProjectItemKind, id: string) => `${kind}:${id}`;
  const of = (kind: ProjectItemKind, id: string) => members.get(key(kind, id)) ?? [];
  const has = (kind: ProjectItemKind, id: string) => live.get(kind)?.().includes(id) ?? false;
  return {
    register: (kind, ids, seed) => {
      live.set(kind, ids);
      for (const row of seed) members.set(key(kind, row.id), [...row.project_ids]);
    },
    of,
    has,
    add: (projectId, kind, id) => {
      const now = of(kind, id);
      if (!now.includes(projectId)) members.set(key(kind, id), [...now, projectId]);
    },
    remove: (projectId, kind, id) => {
      members.set(key(kind, id), of(kind, id).filter((p) => p !== projectId));
    },
    dropProject: (projectId) => {
      for (const [k, ids] of members) members.set(k, ids.filter((p) => p !== projectId));
    },
    count: (projectId, kind) => (live.get(kind)?.() ?? []).filter((id) => of(kind, id).includes(projectId)).length,
  };
}
