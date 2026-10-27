// Type guards for reading untrusted JSON bodies; the parsers build wire types from these.
import type { ClipStatus } from './types';

/** A JSON object with unknown fields. */
export type Json = Record<string, unknown>;

/** True for a non-null object. */
export const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null;

/** True for a string. */
export const isString = (value: unknown): value is string => typeof value === 'string';

/** True for a finite number. */
export const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** True for an integer >= 0. */
export const isNonNegativeInt = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

/** True for an integer > 0. */
export const isPositiveInt = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) > 0;

/** True for a boolean. */
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/** True for an array of strings. */
export const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

/**
 * Wraps a guard so null also passes.
 * @param value - The value to test.
 * @param guard - Guard for the non-null case.
 * @returns True when `value` is null or passes `guard`.
 */
export const isNullable = <T>(value: unknown, guard: (v: unknown) => v is T): value is T | null =>
  value === null || guard(value);

const CLIP_STATUSES: readonly ClipStatus[] = [
  'uploading',
  'uploaded',
  'processing',
  'ready',
  'failed',
  'duplicate',
];

/** True for a known clip status. */
export const isClipStatus = (value: unknown): value is ClipStatus =>
  CLIP_STATUSES.some((status) => status === value);

/**
 * Parses every element of an array, failing the whole array on one bad element.
 * @param value - Candidate array.
 * @param parse - Element parser returning null on a bad element.
 * @returns The parsed elements, or null.
 */
export function parseEvery<T>(value: unknown, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.map(parse);
  return items.every((item) => item !== null) ? items : null;
}
