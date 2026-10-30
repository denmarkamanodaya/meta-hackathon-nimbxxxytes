// Parsers for the Ask box endpoints: the transcript of a voice note and the intent Muse Spark read
// from a request. Every contract key is always present (null or [] when empty); a missing key
// fails the parse.
import { isAspect, isNullable, isNumber, isRecord, isString, isStringArray, oneOf, parseEvery } from './json-guards';
import type { Parse } from './parse';
import { INTENT_KINDS, INTENT_SOURCES, type IntentAnswer, type IntentChoice, type TranscribeResponse } from './types';

const isIntentKind = oneOf(INTENT_KINDS);
const isIntentSource = oneOf(INTENT_SOURCES);
const isNullableString = (v: unknown): v is string | null => isNullable(v, isString);

/**
 * Parses the `POST /api/transcribe` answer.
 * @param body - Candidate body.
 * @returns The transcript, or null when the shape is wrong.
 */
export const parseTranscribe: Parse<TranscribeResponse> = (body) =>
  isRecord(body) && isString(body.text) ? { text: body.text } : null;

const parseChoice = (value: unknown): IntentChoice | null =>
  isRecord(value) && isString(value.label) && isString(value.text) ? { label: value.label, text: value.text } : null;

/**
 * Parses the `POST /api/intents` answer.
 * @param body - Candidate body.
 * @returns The intent, or null when the shape is wrong.
 */
export const parseIntent: Parse<IntentAnswer> = (body) => {
  if (!isRecord(body)) return null;
  const { kind, title, query, source, project_id, new_project_name, clip_ids, target_s, aspect } = body;
  if (!isIntentKind(kind) || !isString(title) || !isNullableString(query)) return null;
  if (!isNullable(source, isIntentSource) || !isNullableString(project_id) || !isNullableString(new_project_name)) return null;
  if (!isStringArray(clip_ids) || !isNullable(target_s, isNumber) || !isNullable(aspect, isAspect)) return null;
  const choices = parseEvery(body.choices, parseChoice);
  const { document_ids, question, person_id, clip_id, viewer_id } = body;
  if (choices === null || !isStringArray(document_ids) || !isNullableString(question)) return null;
  if (!isNullableString(person_id) || !isNullableString(clip_id) || !isNullableString(viewer_id)) return null;
  return { kind, title, query, source, project_id, new_project_name, clip_ids, target_s, aspect, choices, document_ids, question, person_id, clip_id, viewer_id };
};
