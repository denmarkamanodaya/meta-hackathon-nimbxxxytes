import { describe, expect, it } from 'vitest';
import type { UploadItem } from '../services/upload/queue';
import { formatTimeLeft, summarizeUploads } from './upload-summary';

const item = (state: UploadItem['state'], sizeBytes: number, loadedBytes = 0, bytesPerSecond: number | null = null): UploadItem => ({
  id: `${state}-${String(sizeBytes)}`,
  name: 'a.mp4',
  sizeBytes,
  state,
  loadedBytes,
  bytesPerSecond,
  resumed: false,
  partsDone: 0,
  partsTotal: 0,
  errorMessage: null,
  clipId: null,
});

describe('summarizeUploads', () => {
  it('counts sent files, bytes left and time left at the current speed', () => {
    const summary = summarizeUploads([item('done', 100), item('uploading', 200, 50, 10), item('queued', 100)]);

    expect(summary).toEqual({ sent: 1, total: 3, bytesLeft: 250, secondsLeft: 25, fraction: 150 / 400 });
  });

  it('has no time left estimate without a speed, and nothing for an empty queue', () => {
    expect(summarizeUploads([item('queued', 10)]).secondsLeft).toBeNull();
    expect(summarizeUploads([])).toEqual({ sent: 0, total: 0, bytesLeft: 0, secondsLeft: null, fraction: 0 });
  });
});

describe('formatTimeLeft', () => {
  it('rounds to friendly units', () => {
    expect(formatTimeLeft(180)).toBe('~3 min');
    expect(formatTimeLeft(42)).toBe('~40 s');
    expect(formatTimeLeft(2)).toBe('~5 s');
    expect(formatTimeLeft(5400)).toBe('~1.5 h');
    expect(formatTimeLeft(null)).toBe('');
  });
});
