// Productions (`/productions`): the Mac sidebar's Studio entry next to Shorts. The PWA shows the
// same list under the Studio tab's switch; this route serves it there too.
import { ProductionsView } from '../components/ProductionsList';
import { PRODUCTION_COPY } from '../core/copy';

/**
 * The page.
 * @returns The Productions list.
 */
export function ProductionsPage() {
  return <ProductionsView title={PRODUCTION_COPY.productions} subtitle={PRODUCTION_COPY.macSubtitle} />;
}
