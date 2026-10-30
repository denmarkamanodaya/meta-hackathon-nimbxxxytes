// Sends one photo: registers it (with the file's last-modified time, the date taken when the photo
// carries none), then the image itself through the API with the type it was told; the server queues
// the analysis. When the file does not get there, the empty photo is deleted again.
import { photoFileProblem, photoType } from '../../core/photos';
import type { ApiClient } from '../api/client';

/**
 * Uploads one photo.
 * @param api - The API client.
 * @param file - The picked image.
 * @returns The photo id; rejects with why it did not go up.
 */
export async function uploadPhoto(api: Pick<ApiClient, 'createPhoto' | 'sendPhotoSource' | 'deletePhoto'>, file: File): Promise<string> {
  const problem = photoFileProblem(file);
  const type = photoType(file.name, file.type);
  if (problem !== null || type === null) throw new Error(problem ?? 'Not a photo');
  const created = await api.createPhoto({
    filename: file.name,
    content_type: type,
    size_bytes: file.size,
    last_modified: file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null,
  });
  try {
    // The body must carry the type the API was told; a picker may have left it empty.
    await api.sendPhotoSource(created.photo_id, file.type === type ? file : new Blob([file], { type }));
  } catch (error) {
    await api.deletePhoto(created.photo_id).catch(() => {
      // Recovers: the empty photo stays and can be deleted by hand.
    });
    throw error;
  }
  return created.photo_id;
}
