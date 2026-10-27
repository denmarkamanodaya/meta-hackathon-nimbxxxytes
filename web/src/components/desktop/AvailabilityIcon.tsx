// Where a clip is on the Mac, as one round icon: a cloud (in the cloud), a half-full disc (on this
// Mac for a few minutes) or a down arrow (kept offline). The same icons on tiles, the legend, the
// meter and the On this Mac page.
import { AVAILABILITY_COPY } from '../../core/copy';
import type { Availability } from '../../core/on-this-mac';
import { Icon, type IconName } from '../../design/Icon';
import './AvailabilityIcon.css';

const ICON: Record<Availability, IconName> = { cloud: 'cloud', cached: 'half', kept: 'keep' };

/** Props for `AvailabilityIcon`. */
export interface AvailabilityIconProps {
  state: Availability;
  /** `md` 26 px (tiles, legend, strip); `lg` 32 px (list rows). */
  size?: 'md' | 'lg';
  /** Over footage: the cloud sits on the dark scrim instead of the muted fill. */
  onMedia?: boolean;
  /** Announce the state (alone on a tile); false when words sit next to it. */
  isLabelled?: boolean;
}

/**
 * The icon.
 * @param props - See `AvailabilityIconProps`.
 * @returns The span.
 */
export function AvailabilityIcon({ state, size = 'md', onMedia = false, isLabelled = false }: AvailabilityIconProps) {
  const className = `availability availability--${state} availability--${size}${onMedia ? ' availability--media' : ''}`;
  return (
    <span className={className} {...(isLabelled ? { role: 'img', 'aria-label': AVAILABILITY_COPY[state] } : { 'aria-hidden': true })}>
      <Icon name={ICON[state]} size={size === 'lg' ? 'sm' : 'xs'} />
    </span>
  );
}
