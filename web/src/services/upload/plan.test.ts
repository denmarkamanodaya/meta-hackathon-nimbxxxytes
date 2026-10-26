import { describe, expect, it } from 'vitest';
import { bytesDone, fingerprint, MAX_PARTS, missingParts, planParts } from './plan';

const MiB = 1024 * 1024;

describe('planParts', () => {
  it('splits into full parts plus a smaller last part', () => {
    const plan = planParts(20 * MiB, 8 * MiB);

    expect(plan).toEqual([
      { n: 1, start: 0, end: 8 * MiB },
      { n: 2, start: 8 * MiB, end: 16 * MiB },
      { n: 3, start: 16 * MiB, end: 20 * MiB },
    ]);
  });

  it('uses exactly size / partSize parts when the size divides evenly', () => {
    expect(planParts(32 * MiB, 16 * MiB)).toHaveLength(2);
  });

  it('gives an empty file one empty part', () => {
    expect(planParts(0, 8 * MiB)).toEqual([{ n: 1, start: 0, end: 0 }]);
  });

  it('allows exactly 10,000 parts and rejects one more', () => {
    expect(planParts(MAX_PARTS * 10, 10)).toHaveLength(MAX_PARTS);
    expect(() => planParts(MAX_PARTS * 10 + 1, 10)).toThrow(RangeError);
  });

  it('rejects a zero part size and a negative file size', () => {
    expect(() => planParts(10, 0)).toThrow(RangeError);
    expect(() => planParts(-1, 10)).toThrow(RangeError);
  });
});

describe('fingerprint', () => {
  it('combines name, size and lastModified', () => {
    expect(fingerprint({ name: 'a.mp4', size: 42, lastModified: 1700 })).toBe('a.mp4|42|1700');
  });

  it('differs when the same name has a different size or date', () => {
    const base = { name: 'a.mp4', size: 42, lastModified: 1700 };

    expect(fingerprint({ ...base, size: 43 })).not.toBe(fingerprint(base));
    expect(fingerprint({ ...base, lastModified: 1701 })).not.toBe(fingerprint(base));
  });
});

describe('missingParts and bytesDone', () => {
  const plan = planParts(20 * MiB, 8 * MiB);
  const done = [{ n: 3, etag: '"c"' }, { n: 1, etag: '"a"' }];

  it('lists only the parts without an ETag, ascending', () => {
    expect(missingParts(plan, done)).toEqual([2]);
    expect(missingParts(plan, [])).toEqual([1, 2, 3]);
  });

  it('counts the bytes of finished parts, including a short last part', () => {
    expect(bytesDone(plan, done)).toBe(12 * MiB);
  });
});
