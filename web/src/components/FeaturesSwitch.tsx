// The PWA's switches under the Features and Accessibility tabs (owner ruling 2026-10-30, mirroring
// the Mac sidebar): Faces | Shorts under Features, iGuide | iRead | iListen | Memory Lane under Accessibility. The
// Mac app lists them in its sidebar instead.
import { useNavigate } from 'react-router';
import { NAV_COPY, STUDIO_COPY } from '../core/copy';
import { GUIDE_COPY } from '../core/guides';
import { ILISTEN_COPY } from '../core/ilisten/listens';
import { IREAD_COPY } from '../core/iread/documents';
import { MEMORY_COPY } from '../core/memory-lane/memories';
import { SegmentedTabs } from '../design/SegmentedTabs';
import './FeaturesSwitch.css';

/** A list under Features or Accessibility; each is its own route. */
export type FeatureView = 'faces' | 'shorts' | 'guides' | 'iread' | 'ilisten' | 'memoryLane';

/** One tab's group of lists. */
interface FeatureGroup {
  label: string;
  options: readonly { value: FeatureView; label: string }[];
}

const FEATURES: FeatureGroup = {
  label: NAV_COPY.features,
  options: [
    { value: 'faces', label: NAV_COPY.faces },
    { value: 'shorts', label: STUDIO_COPY.shorts },
  ],
};

const ACCESSIBILITY: FeatureGroup = {
  label: NAV_COPY.accessibility,
  options: [
    { value: 'guides', label: GUIDE_COPY.guides },
    { value: 'iread', label: IREAD_COPY.section },
    { value: 'ilisten', label: ILISTEN_COPY.section },
    { value: 'memoryLane', label: MEMORY_COPY.section },
  ],
};

/** Each list's route (the Features tab opens Faces' and Shorts', Accessibility the other four). */
export const FEATURE_PATHS: Readonly<Record<FeatureView, string>> = {
  faces: '/people',
  shorts: '/shorts',
  guides: '/guides',
  iread: '/iread',
  ilisten: '/ilisten',
  memoryLane: '/memory-lane',
};

/**
 * The group a list sits in.
 * @param view - The list on screen.
 * @returns Features for Faces and Shorts, else Accessibility.
 */
const groupOf = (view: FeatureView): FeatureGroup => (FEATURES.options.some((option) => option.value === view) ? FEATURES : ACCESSIBILITY);

/** Props for `FeaturesSwitch`. */
export interface FeaturesSwitchProps {
  /** The list on screen. */
  view: FeatureView;
}

/**
 * The switch of the list's group; picking another list opens its route in place of this one.
 * @param props - See `FeaturesSwitchProps`.
 * @returns The tab list.
 */
export function FeaturesSwitch({ view }: FeaturesSwitchProps) {
  const navigate = useNavigate();
  const group = groupOf(view);
  return (
    <div className="features-switch">
      <SegmentedTabs
        label={group.label}
        options={group.options}
        value={view}
        onChange={(next) => {
          if (next !== view) void navigate(FEATURE_PATHS[next], { replace: true });
        }}
      />
    </div>
  );
}
