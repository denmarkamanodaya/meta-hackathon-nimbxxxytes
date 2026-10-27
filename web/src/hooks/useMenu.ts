// Open/close state of one pop-up menu: from its ⋯ button, or at the pointer on right-click.
import { useCallback, useState, type MouseEvent } from 'react';
import type { MenuAnchor } from '../core/menu-position';

/** A menu's state and openers. */
export interface MenuControl {
  /** Where it is open, or null. */
  anchor: MenuAnchor | null;
  /** Opens under the clicked button (for the ⋯ button's onClick). */
  openFromButton: (event: MouseEvent<HTMLElement>) => void;
  /** Opens at the pointer instead of the browser's own menu (for onContextMenu). */
  openAtPointer: (event: MouseEvent<HTMLElement>) => void;
  close: () => void;
}

/**
 * State for one menu.
 * @returns The control.
 */
export function useMenu(): MenuControl {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const openFromButton = useCallback((event: MouseEvent<HTMLElement>) => {
    const { left, top, right, bottom } = event.currentTarget.getBoundingClientRect();
    setAnchor({ kind: 'button', box: { left, top, right, bottom } });
  }, []);
  const openAtPointer = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    setAnchor({ kind: 'point', point: { x: event.clientX, y: event.clientY } });
  }, []);
  const close = useCallback(() => {
    setAnchor(null);
  }, []);
  return { anchor, openFromButton, openAtPointer, close };
}
