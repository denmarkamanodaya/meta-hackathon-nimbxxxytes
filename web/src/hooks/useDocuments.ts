// iRead document hooks: the list, one document (polled while it is read), adding a photo or PDF
// (the file goes through the API, then Muse Spark reads it), trying a stuck upload again, asking
// a question, renaming and deleting. Each failure raises a toast.
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { describeError } from '../core/error-text';
import { documentFileProblem, documentType, IREAD_COPY, isDocBusy, isUploadStuck } from '../core/iread/documents';
import type { DocumentAnswer, DocumentDetail, DocumentSummary } from '../services/api/types';
import { usePolled, type Polled } from './usePolled';
import { useServices } from './services-context';

/** The iRead list's route. */
export const IREAD_PATH = '/iread';

/** The route of one document. */
export const documentPath = (documentId: string): string => `${IREAD_PATH}/${encodeURIComponent(documentId)}`;

/** List poll interval, ms (a document being read changes its row). */
export const DOCUMENTS_POLL_MS = 5000;
/** One document's poll interval while it is read, ms (a page takes a few seconds). */
export const DOCUMENT_POLL_MS = 1500;

/** How often the pages look again for an upload that has become stuck, ms (`useNow`). */
export const STUCK_TICK_MS = 15_000;

/**
 * Every document, newest first as the API sends them.
 * @returns The polled list and `refresh`.
 */
export function useDocuments(): { state: Polled<DocumentSummary[]>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.listDocuments(signal), [api]);
  return usePolled(load, { intervalMs: DOCUMENTS_POLL_MS });
}

/** Poll while it is uploaded or read; a stuck upload changes no more, so it is not polled. */
const keepPollingDocument = (doc: DocumentDetail) => isDocBusy(doc.status) && !isUploadStuck(doc, Date.now());

/**
 * One document, polled until it is read or failed.
 * @param documentId - The document.
 * @returns The polled document and `refresh`.
 */
export function useDocument(documentId: string): { state: Polled<DocumentDetail>; refresh: () => void } {
  const { api } = useServices();
  const load = useCallback((signal: AbortSignal) => api.getDocument(documentId, signal), [api, documentId]);
  return usePolled(load, { intervalMs: DOCUMENT_POLL_MS, keepPolling: keepPollingDocument });
}

/** Adding a photo or PDF. */
export interface AddDocument {
  /** Uploads the file and asks Muse Spark to read it; resolves its id, or null (with a toast). */
  add: (file: File) => Promise<string | null>;
  isAdding: boolean;
  /** Why the last add failed, for the page to show beside the toast; null after a success. */
  error: string | null;
}

/**
 * Snap a letter, Choose a PDF, Upload a photo or PDF…: registers the document, then sends the
 * file itself through the API with the type the API was told (the server stores it and the read
 * job starts). One path on every platform. When the file does not get there, the empty document
 * is deleted again so no row waits on a file that never comes.
 * @returns `add`, whether one runs and the last failure.
 */
export function useAddDocument(): AddDocument {
  const { api, toasts } = useServices();
  const [isAdding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(
    async (file: File) => {
      const problem = documentFileProblem(file);
      const type = documentType(file.name, file.type);
      if (problem !== null || type === null) {
        const why = problem ?? 'Choose a photo or a PDF.';
        setError(why);
        toasts.info('This file cannot be read', why);
        return null;
      }
      setAdding(true);
      setError(null);
      let createdId: string | null = null;
      try {
        const created = await api.createDocument({ filename: file.name, content_type: type, size_bytes: file.size });
        createdId = created.document_id;
        // The body must carry the type the API was told; a picker may have left it empty.
        const body = file.type === type ? file : new Blob([file], { type });
        await api.sendDocumentSource(created.document_id, body);
        return created.document_id;
      } catch (thrown) {
        if (createdId !== null) {
          await api.deleteDocument(createdId).catch(() => {
            // Recovers: the empty document stays and shows "This upload didn't finish" later.
          });
        }
        setError(describeError(thrown).text);
        toasts.error(IREAD_COPY.addFailed, thrown);
        return null;
      } finally {
        setAdding(false);
      }
    },
    [api, toasts],
  );
  return { add, isAdding, error };
}

/** Try again on a stuck upload. */
export interface RetryUpload {
  /** Adds the re-picked file as a new document, then deletes the stuck one; resolves the new id. */
  retry: (stuckId: string, file: File) => Promise<string | null>;
  isAdding: boolean;
  error: string | null;
}

/**
 * Try again (re-pick the file) on an upload that never finished: the file is added afresh (the
 * re-picked file may be another type) and the stuck document is deleted once the new one is in.
 * @returns `retry`, whether it runs and the last failure.
 */
export function useRetryUpload(): RetryUpload {
  const { api } = useServices();
  const { add, isAdding, error } = useAddDocument();
  const retry = useCallback(
    async (stuckId: string, file: File) => {
      const id = await add(file);
      if (id === null) return null;
      await api.deleteDocument(stuckId).catch(() => {
        // Recovers: the stuck row stays and can still be deleted by hand.
      });
      return id;
    },
    [add, api],
  );
  return { retry, isAdding, error };
}

/** Asking about a document. */
export interface AskDocument {
  /** The last question and its answer; null before one. */
  answer: DocumentAnswer | null;
  /** The question being answered; null when none is. */
  asking: string | null;
  /** Sends the question; resolves the answer, or null (with a toast). */
  ask: (question: string) => Promise<DocumentAnswer | null>;
}

/**
 * The question field and hold to ask on a document's page.
 * @param documentId - The document.
 * @returns The answer, what is being asked, and `ask`.
 */
export function useAskDocument(documentId: string): AskDocument {
  const { api, toasts } = useServices();
  const [answer, setAnswer] = useState<DocumentAnswer | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const ask = useCallback(
    async (question: string) => {
      const clean = question.trim();
      if (clean === '') return null;
      setAsking(clean);
      try {
        const answered = await api.askDocument(documentId, clean);
        setAnswer(answered);
        return answered;
      } catch (error) {
        toasts.error('Could not answer that', error);
        return null;
      } finally {
        setAsking(null);
      }
    },
    [api, documentId, toasts],
  );
  return { answer, asking, ask };
}

/** Renaming a document. */
export interface RenameDocument {
  /** Stores the new title; resolves true on success. */
  rename: (documentId: string, title: string) => Promise<boolean>;
  isSaving: boolean;
}

/**
 * Rename…: PATCHes the title; a failure raises a toast.
 * @param onRenamed - Called after a rename succeeds, to reload what shows the title.
 * @returns `rename` and whether it runs.
 */
export function useRenameDocument(onRenamed: () => void): RenameDocument {
  const { api, toasts } = useServices();
  const [isSaving, setSaving] = useState(false);
  const rename = useCallback(
    async (documentId: string, title: string) => {
      setSaving(true);
      try {
        await api.renameDocument(documentId, title);
        onRenamed();
        return true;
      } catch (error) {
        toasts.error('Could not rename the letter', error);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api, onRenamed, toasts],
  );
  return { rename, isSaving };
}

/** Deleting a document. */
export interface DeleteDocument {
  /** Deletes it and opens the iRead list; resolves false (with a toast) when it failed. */
  remove: (documentId: string) => Promise<boolean>;
  isDeleting: boolean;
}

/**
 * Delete letter: removes the document and leaves for the iRead list, replacing it in history.
 * @returns `remove` and whether it runs.
 */
export function useDeleteDocument(): DeleteDocument {
  const { api, toasts } = useServices();
  const navigate = useNavigate();
  const [isDeleting, setDeleting] = useState(false);
  const remove = useCallback(
    async (documentId: string) => {
      setDeleting(true);
      try {
        await api.deleteDocument(documentId);
        void navigate(IREAD_PATH, { replace: true });
        return true;
      } catch (error) {
        toasts.error('Could not delete the letter', error);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [api, navigate, toasts],
  );
  return { remove, isDeleting };
}
