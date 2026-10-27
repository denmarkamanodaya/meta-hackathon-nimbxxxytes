import { describe, expect, it } from 'vitest';
import type { UploadItem } from '../services/upload/queue';
import { formatTimeLeft, itemLine, itemProgress, queueHeading, queueLeftLine, summarizeUploads } from './upload-summary';

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
    expect(formatTimeLeft(180)).toBe('about 3 min');
    expect(formatTimeLeft(42)).toBe('about 40 s');
    expect(formatTimeLeft(2)).toBe('about 5 s');
    expect(formatTimeLeft(5400)).toBe('about 1.5 h');
    expect(formatTimeLeft(null)).toBe('');
  });
});

describe('queueHeading and queueLeftLine', () => {
  it('counts the file going up, then says all were sent', () => {
    expect(queueHeading({ sent: 1, total: 3 })).toBe('Uploading 2 of 3');
    expect(queueHeading({ sent: 3, total: 3 })).toBe('All 3 sent');
    expect(queueHeading({ sent: 1, total: 1 })).toBe('Sent');
  });

  it('gives bytes and time left, or nothing once everything is sent', () => {
    expect(queueLeftLine({ bytesLeft: 2_800_000_000, secondsLeft: 180 })).toBe('2.8 GB · about 3 min');
    expect(queueLeftLine({ bytesLeft: 2_800_000_000, secondsLeft: null })).toBe('2.8 GB');
    expect(queueLeftLine({ bytesLeft: 0, secondsLeft: null })).toBe('');
  });
});

describe('itemProgress', () => {
  it('says Waiting until bytes move, then the whole percentage', () => {
    expect(itemProgress({ loadedBytes: 0, sizeBytes: 100 })).toBe('Waiting');
    expect(itemProgress({ loadedBytes: 64, sizeBytes: 100 })).toBe('64%');
    expect(itemProgress({ loadedBytes: 999, sizeBytes: 1000 })).toBe('99%');
  });
});

describe('itemLine', () => {
  it('gives a sending file its size and the time it has left at its speed', () => {
    expect(itemLine({ state: 'uploading', sizeBytes: 1_200_000_000, loadedBytes: 768_000_000, bytesPerSecond: 3_600_000 }, false)).toBe(
      '1.2 GB · about 2 min left',
    );
    expect(itemLine({ state: 'uploading', sizeBytes: 1_200_000_000, loadedBytes: 0, bytesPerSecond: null }, false)).toBe('1.2 GB');
  });

  it('says which waiting file starts next', () => {
    expect(itemLine({ state: 'queued', sizeBytes: 900_000_000, loadedBytes: 0, bytesPerSecond: null }, true)).toBe('900 MB · starts next');
    expect(itemLine({ state: 'queued', sizeBytes: 900_000_000, loadedBytes: 0, bytesPerSecond: null }, false)).toBe('900 MB · waiting');
  });
});
