// The round Select-mode tick shared by the Gallery grid tile and the list row: an empty ring, filled
// with the accent and a check once the clip is ticked. Decorative: the tile and row carry the state.
import { Icon } from '../../design/Icon';
import './SelectTick.css';

/**
 * The tick.
 * @param props - Whether it is ticked, and a class that places it.
 * @returns The ring.
 */
export function SelectTick({ isOn, className }: { isOn: boolean; className?: string }) {
  const classes = ['select-tick', isOn ? 'select-tick--on' : '', className ?? ''].filter((name) => name !== '').join(' ');
  return (
    <span className={classes} aria-hidden="true">
      {isOn && <Icon name="check" size="xs" />}
    </span>
  );
}
