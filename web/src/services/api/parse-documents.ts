// Parsers for the iRead document endpoints: the list, one document with its pages, the upload
// answers, an answer to a question and one spoken part of the text. Every contract key is always
// present (null or "" when empty); a missing key fails the parse.
import { isNonNegativeInt, isNullable, isPositiveInt, isRecord, isString, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import {
  DOC_KINDS,
  DOC_STATUSES,
  type CompleteDocumentResponse,
  type CreateDocumentResponse,
  type DocumentAnswer,
  type DocumentDetail,
  type DocumentPage,
  type DocumentPart,
  type DocumentSummary,
} from './types';

const isDocKind = oneOf(DOC_KINDS);
const isDocStatus = oneOf(DOC_STATUSES);
const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);

/**
 * Parses one `GET /api/documents` row.
 * @param body - Candidate row.
 * @returns The row, or null when the shape is wrong.
 */
export const parseDocumentSummary: Parse<DocumentSummary> = (body) => {
  if (!isRecord(body)) return null;
  const { id, title, kind, sender, date, status, page_count, thumb_url, created_at, error } = body;
  if (!isString(id) || !isString(title) || !isDocKind(kind) || !isString(sender) || !isString(date)) return null;
  if (!isDocStatus(status) || !isNonNegativeInt(page_count) || !isNullableString(thumb_url)) return null;
  if (!isString(created_at) || !isNullableString(error)) return null;
  return { id, title, kind, sender, date, status, page_count, thumb_url, created_at, error };
};

/** Parses `GET /api/documents`. One malformed row rejects the whole list. */
export const parseDocumentList: Parse<DocumentSummary[]> = (body) => parseEvery(body, parseDocumentSummary);

const parsePage = (value: unknown): DocumentPage | null =>
  isRecord(value) && isPositiveInt(value.n) && isString(value.image_url) ? { n: value.n, image_url: value.image_url } : null;

/**
 * Parses `GET /api/documents/{id}` (and the `PATCH` answer).
 * @param body - Candidate document.
 * @returns The document, or null when the shape is wrong.
 */
export const parseDocument: Parse<DocumentDetail> = (body) => {
  if (!isRecord(body)) return null;
  const head = parseDocumentSummary(body);
  const pages = parseEvery(body.pages, parsePage);
  const { summary, text, summary_audio_url } = body;
  if (head === null || pages === null || !isString(summary) || !isString(text) || !isNullableString(summary_audio_url)) return null;
  return { ...head, summary, text, pages, summary_audio_url };
};

/** Parses the `POST /api/documents` answer. */
export const parseCreateDocument: Parse<CreateDocumentResponse> = (body) =>
  isRecord(body) && isString(body.document_id) && isString(body.upload_url)
    ? { document_id: body.document_id, upload_url: body.upload_url }
    : null;

/** Parses the `POST /api/documents/{id}/complete` answer. */
export const parseCompleteDocument: Parse<CompleteDocumentResponse> = (body) =>
  isRecord(body) && isString(body.document_id) && isDocStatus(body.status) ? { document_id: body.document_id, status: body.status } : null;

/** Parses the `POST /api/documents/{id}/ask` answer. */
export const parseDocumentAnswer: Parse<DocumentAnswer> = (body) =>
  isRecord(body) && isString(body.question) && isString(body.answer) && isNullableString(body.audio_url)
    ? { question: body.question, answer: body.answer, audio_url: body.audio_url }
    : null;

/** Parses the `POST /api/documents/{id}/speak` answer. */
export const parseDocumentPart: Parse<DocumentPart> = (body) => {
  if (!isRecord(body)) return null;
  const { part, parts, text, audio_url } = body;
  if (!isNonNegativeInt(part) || !isPositiveInt(parts) || part >= parts || !isString(text) || !isNullableString(audio_url)) return null;
  return { part, parts, text, audio_url };
};
