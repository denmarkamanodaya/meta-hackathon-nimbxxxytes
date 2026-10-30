import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../api/client';
import { uploadPhoto } from './photo-upload';

const apiWith = (sendPhotoSource: ApiClient['sendPhotoSource']) => ({
  createPhoto: vi.fn<ApiClient['createPhoto']>().mockResolvedValue({ photo_id: 'p1', status: 'uploading' }),
  sendPhotoSource: vi.fn(sendPhotoSource),
  deletePhoto: vi.fn<ApiClient['deletePhoto']>().mockResolvedValue(true),
});

describe('uploadPhoto', () => {
  it('registers with the last-modified time, then sends the file with the type it was told', async () => {
    const api = apiWith(() => Promise.resolve({ photo_id: 'p1', status: 'analysing' }));
    const file = new File(['jpeg'], 'IMG_1.HEIC', { type: '', lastModified: Date.UTC(2026, 7, 19, 8, 42) });

    expect(await uploadPhoto(api, file)).toBe('p1');

    expect(api.createPhoto).toHaveBeenCalledWith({ filename: 'IMG_1.HEIC', content_type: 'image/heic', size_bytes: 4, last_modified: '2026-08-19T08:42:00.000Z' });
    const sent = api.sendPhotoSource.mock.calls[0]?.[1];
    expect(api.sendPhotoSource.mock.calls[0]?.[0]).toBe('p1');
    expect(sent?.type).toBe('image/heic');
  });

  it('deletes the empty photo when the file does not get there, and never sends a non-photo', async () => {
    const api = apiWith(() => Promise.reject(new Error('offline')));
    await expect(uploadPhoto(api, new File(['x'], 'a.jpg', { type: 'image/jpeg' }))).rejects.toThrow('offline');
    expect(api.deletePhoto).toHaveBeenCalledWith('p1');

    const fresh = apiWith(() => Promise.resolve({ photo_id: 'p1', status: 'analysing' }));
    await expect(uploadPhoto(fresh, new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toThrow('JPEG');
    expect(fresh.createPhoto).not.toHaveBeenCalled();
  });
});
