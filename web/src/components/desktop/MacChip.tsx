// The compact Mac chip of redesign v2 (24 px, rounded, a border): a filter that is on shows accent
// text and border (Shorts: All, Ready, From productions); without `isOn` it is a plain action
// (New production: the "Start from" briefs).
import type { ReactNode } from 'react';
import './MacChip.css';

/** Props for `MacChip`. */
export interface MacChipProps {
  children: ReactNode;
  onClick: () => void;
  /** A filter's state; left out, the chip is an action and has no pressed state. */
  isOn?: boolean;
}

/**
 * The chip.
 * @param props - See `MacChipProps`.
 * @returns The button.
 */
export function MacChip({ children, onClick, isOn }: MacChipProps) {
  return (
    <button type="button" className={isOn === true ? 'mac-chip mac-chip--on' : 'mac-chip'} aria-pressed={isOn} onClick={onClick}>
      {children}
    </button>
  );
}
