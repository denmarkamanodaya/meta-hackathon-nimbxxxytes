// Shares the final MP4 through the system share sheet (Web Share API with a file), so on iOS it
// can go straight to Instagram or Photos. Fetches the presigned URL into a File first; the
// bucket's CORS rule must allow GET from the app origin.
import { ApiError } from '../api/client';

/** What happened when the user tried to share. */
export type ShareOutcome = 'shared' | 'cancelled' | 'unsupported';

/**
 * Shares a video file.
 * @returns `unsupported` when the browser cannot share files (the UI then offers a download).
 */
export type ShareVideo = (url: string, filename: string, title: string) => Promise<ShareOutcome>;

/** The navigator surface used; tests inject a fake. */
export interface ShareTarget {
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

/**
 * Builds the sharer.
 * @param target - `navigator`, or a fake.
 * @param fetchFn - Fetch implementation; defaults to the global one.
 * @returns The sharer. Rejects with `ApiError` (`NETWORK_ERROR` / `PART_FAILED`) when the file
 *   cannot be fetched.
 */
export function createVideoSharer(
  target: ShareTarget,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): ShareVideo {
  return async (url, filename, title) => {
    if (target.share === undefined || target.canShare === undefined) return 'unsupported';
    let response: Response;
    try {
      response = await fetchFn(url);
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Could not download the video', null);
    }
    if (!response.ok) {
      throw new ApiError('PART_FAILED', `Storage answered ${String(response.status)}`, response.status);
    }
    const file = new File([await response.blob()], filename, { type: 'video/mp4' });
    const data: ShareData = { files: [file], title };
    if (!target.canShare(data)) return 'unsupported';
    try {
      await target.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  };
}
