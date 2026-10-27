// The PWA Studio's Shorts | Productions switch (the Mac app has both in its sidebar instead).
import { PRODUCTION_COPY, STUDIO_COPY } from '../core/copy';
import { SegmentedTabs } from '../design/SegmentedTabs';
import type { StudioView } from '../services/studio-view';
import './StudioSwitch.css';

const OPTIONS = [
  { value: 'shorts', label: STUDIO_COPY.shorts },
  { value: 'productions', label: PRODUCTION_COPY.productions },
] as const;

/** Props for `StudioSwitch`. */
export interface StudioSwitchProps {
  view: StudioView;
  onChange: (view: StudioView) => void;
}

/**
 * The switch.
 * @param props - See `StudioSwitchProps`.
 * @returns The tab list.
 */
export function StudioSwitch({ view, onChange }: StudioSwitchProps) {
  return (
    <div className="studio-switch">
      <SegmentedTabs label="Studio lists" options={OPTIONS} value={view} onChange={onChange} />
    </div>
  );
}
