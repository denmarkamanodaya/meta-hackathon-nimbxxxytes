// Status chip that shows whether the API is reachable.
import { Chip } from '../design/Chip';
import { useHealth, type HealthState } from '../hooks/useHealth';

const LABEL: Record<HealthState, string> = {
  checking: 'Connecting…',
  online: 'Online',
  offline: 'Offline',
};

const TONE = { checking: 'neutral', online: 'success', offline: 'danger' } as const;

/**
 * Small chip with the API's reachability; announced politely to screen readers.
 * @returns The chip inside a live region.
 */
export function HealthChip() {
  const state = useHealth();
  return (
    <span role="status" aria-live="polite">
      <Chip tone={TONE[state]}>{LABEL[state]}</Chip>
    </span>
  );
}
