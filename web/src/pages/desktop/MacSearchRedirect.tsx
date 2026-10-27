// The Mac app has no Search page: the Library is the search. Old `/search?q=` links (a person on
// People & pets, the Shorts and Editor empty states) land on the Library with the same query.
import { Navigate, useSearchParams } from 'react-router';
import { libraryQueryPath } from '../../core/library-query';

/**
 * Sends `/search?q=…` to `/?q=…`.
 * @returns The redirect.
 */
export function MacSearchRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={libraryQueryPath(params.get('q'))} replace />;
}
