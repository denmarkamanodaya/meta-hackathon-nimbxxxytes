// The PWA's Guides | Shorts switch under the Features tab (owner ruling 2026-10-29: Guides and
// Shorts sit together under Features). The Mac app lists both in its sidebar instead.
import { useNavigate } from 'react-router';
import { NAV_COPY, STUDIO_COPY } from '../core/copy';
import { GUIDE_COPY } from '../core/guides';
import { SegmentedTabs } from '../design/SegmentedTabs';
import './FeaturesSwitch.css';

/** A Features list; each is its own route. */
export type FeatureView = 'guides' | 'shorts';

const OPTIONS = [
  { value: 'guides', label: GUIDE_COPY.guides },
  { value: 'shorts', label: STUDIO_COPY.shorts },
] as const;

const PATHS: Record<FeatureView, string> = { guides: '/guides', shorts: '/shorts' };

/** Props for `FeaturesSwitch`. */
export interface FeaturesSwitchProps {
  /** The list on screen. */
  view: FeatureView;
}

/**
 * The switch; picking the other list opens its route in place of this one.
 * @param props - See `FeaturesSwitchProps`.
 * @returns The tab list.
 */
export function FeaturesSwitch({ view }: FeaturesSwitchProps) {
  const navigate = useNavigate();
  return (
    <div className="features-switch">
      <SegmentedTabs
        label={NAV_COPY.features}
        options={OPTIONS}
        value={view}
        onChange={(next) => {
          if (next !== view) void navigate(PATHS[next], { replace: true });
        }}
      />
    </div>
  );
}
