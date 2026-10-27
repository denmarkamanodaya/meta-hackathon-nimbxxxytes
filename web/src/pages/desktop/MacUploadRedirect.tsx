// The Mac app has no Upload page: the Gallery's Upload button opens the native file or folder
// dialog directly, and the uploads show as tiles in the Gallery. Any old `/upload` link (a shared
// page's "Film the missing shots", a bookmark) lands on the Gallery.
import { Navigate } from 'react-router';

/**
 * Sends `/upload` to the Gallery.
 * @returns The redirect.
 */
export function MacUploadRedirect() {
  return <Navigate to="/" replace />;
}
