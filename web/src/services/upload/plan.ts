// Pure multipart rules for the web side: part byte ranges, file fingerprints for resume, and
// which parts are still missing. The server picks the part size; the client only slices.
import type { CompletedPart } from '../api/types';

/** S3's limit on parts per multipart upload. */
export const MAX_PARTS = 10_000;

/** One part's byte range in the file: `[start, end)`, `n` is 1-based. */
export interface PartRange {
  n: number;
  start: number;
  end: number;
}

/**
 * Splits a file into parts of `partSizeBytes`; the last part holds the remainder.
 * An empty file still gets one empty part (S3 needs at least one).
 * @param sizeBytes - File size in bytes, >= 0.
 * @param partSizeBytes - Part size in bytes from the server, > 0.
 * @returns Parts in ascending `n`.
 * @throws RangeError on a negative size, a non-positive part size, or more than 10,000 parts.
 */
export function planParts(sizeBytes: number, partSizeBytes: number): PartRange[] {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 0) throw new RangeError('bad file size');
  if (!Number.isInteger(partSizeBytes) || partSizeBytes <= 0) throw new RangeError('bad part size');
  const count = Math.max(1, Math.ceil(sizeBytes / partSizeBytes));
  if (count > MAX_PARTS) throw new RangeError(`${String(count)} parts exceeds ${String(MAX_PARTS)}`);
  return Array.from({ length: count }, (_, index) => ({
    n: index + 1,
    start: index * partSizeBytes,
    end: Math.min(sizeBytes, (index + 1) * partSizeBytes),
  }));
}

/** The file fields a fingerprint reads; `File` satisfies it. */
export interface FileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

/**
 * Identifies the same file across page loads (name + size + lastModified) for resume.
 * @param file - The picked file.
 * @returns A stable key.
 */
export function fingerprint(file: FileIdentity): string {
  return `${file.name}|${String(file.size)}|${String(file.lastModified)}`;
}

/**
 * Lists the parts that still need uploading.
 * @param plan - Every part of the file.
 * @param done - Parts already uploaded, with their ETags.
 * @returns Part numbers not in `done`, ascending.
 */
export function missingParts(plan: readonly PartRange[], done: readonly CompletedPart[]): number[] {
  const finished = new Set(done.map((part) => part.n));
  return plan.filter((part) => !finished.has(part.n)).map((part) => part.n);
}

/**
 * Sums the bytes of finished parts, for the progress bar after a resume.
 * @param plan - Every part of the file.
 * @param done - Parts already uploaded.
 * @returns Bytes uploaded so far.
 */
export function bytesDone(plan: readonly PartRange[], done: readonly CompletedPart[]): number {
  const finished = new Set(done.map((part) => part.n));
  return plan.filter((part) => finished.has(part.n)).reduce((sum, p) => sum + p.end - p.start, 0);
}
