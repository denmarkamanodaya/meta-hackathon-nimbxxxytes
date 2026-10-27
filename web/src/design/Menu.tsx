// Pop-up menu primitive (mock V4): a small card of actions with an optional separator and a red
// destructive item. Opens under its ⋯ button or at the pointer (right-click), stays inside the
// window, and closes on Esc, Tab, a tap outside, scrolling or picking an item. Arrow keys move
// between items.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { belowButton, clampMenu, type MenuAnchor, type Point } from '../core/menu-position';
import './Menu.css';

/** One row of the menu. */
export type MenuEntry =
  | {
      kind: 'item';
      label: string;
      onSelect: () => void;
      /** Red, for a delete. */
      isDanger?: boolean;
      isDisabled?: boolean;
    }
  | { kind: 'separator' };

/** Props for `Menu`. */
export interface MenuProps {
  /** Where it opens; null keeps it closed. */
  anchor: MenuAnchor | null;
  /** Accessible name ("Clip actions"). */
  label: string;
  items: MenuEntry[];
  onClose: () => void;
}

/** Gap under the button and the smallest distance to the window edges, px (`--space-2`). */
const EDGE = 8;

function cornerFor(anchor: MenuAnchor, menu: HTMLElement): Point {
  const wanted = anchor.kind === 'button' ? belowButton(anchor.box, menu.offsetWidth, EDGE) : anchor.point;
  return clampMenu(wanted, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, EDGE);
}

function moveFocus(menu: HTMLElement, step: 1 | -1) {
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
  const index = items.findIndex((item) => item === document.activeElement);
  items[(index + step + items.length) % items.length]?.focus();
}

/** Closes on a pointer press outside `menu`, on scroll and on resize. */
function useDismiss(menu: RefObject<HTMLDivElement | null>, isOpen: boolean, onClose: () => void) {
  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menu.current?.contains(event.target) !== true) onClose();
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [menu, isOpen, onClose]);
}

/**
 * The menu.
 * @param props - See `MenuProps`.
 * @returns The menu, or nothing while closed.
 */
export function Menu({ anchor, label, items, onClose }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Point | null>(null);
  useDismiss(ref, anchor !== null, onClose);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (anchor === null || menu === null) return;
    setCorner(cornerFor(anchor, menu));
    menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [anchor]);

  if (anchor === null) return null;
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={corner === null ? { visibility: 'hidden' } : { left: corner.x, top: corner.y }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          onClose();
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      {items.map((item, index) =>
        item.kind === 'separator' ? (
          <div key={`separator-${String(index)}`} className="menu__separator" role="separator" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={item.isDanger === true ? 'menu__item menu__item--danger' : 'menu__item'}
            disabled={item.isDisabled === true}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
