// Pop-up menu primitive (mock V4; redesign v2 Gallery list): a small card of actions with optional
// separators, a red destructive item, a shortcut hint at the right of an item, check items with a
// colour square (the Add to project list) and one level of submenu that opens to the right. Opens
// under its ⋯ button or at the pointer (right-click), stays inside the window, and closes on Esc,
// Tab, a tap outside, scrolling or picking an item. Arrow keys move between items; Right opens a
// submenu and Left goes back. A submenu near the right edge opens to the left.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { belowButton, clampMenu, type MenuAnchor, type Point } from '../core/menu-position';
import { Icon, type IconName } from './Icon';
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
      /** A shortcut shown at the right ("⌘R"). */
      hint?: string;
      /** An icon before the label ("New project…"). */
      icon?: IconName;
    }
  | {
      kind: 'check';
      label: string;
      isChecked: boolean;
      onSelect: () => void;
      /** Class of a small colour square before the label. */
      swatchClass?: string;
    }
  | { kind: 'submenu'; label: string; items: MenuEntry[] }
  | { kind: 'separator' };

/** Props for `Menu`. */
export interface MenuProps {
  /** Where it opens; null keeps it closed. */
  anchor: MenuAnchor | null;
  /** Accessible name ("Clip actions"). */
  label: string;
  items: MenuEntry[];
  onClose: () => void;
  /** A class added to the menu for its own width (the narrower Productions menu). */
  className?: string;
}

/** Gap under the button and the smallest distance to the window edges, px (`--space-2`). */
const EDGE = 8;

const ITEMS = '[role="menuitem"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

function cornerFor(anchor: MenuAnchor, menu: HTMLElement): Point {
  const wanted = anchor.kind === 'button' ? belowButton(anchor.box, menu.offsetWidth, EDGE) : anchor.point;
  return clampMenu(wanted, { width: menu.offsetWidth, height: menu.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, EDGE);
}

/** Moves focus among the items of one level (the submenu's items are not the parent's). */
function moveFocus(list: HTMLElement, step: 1 | -1) {
  const items = [...list.querySelectorAll<HTMLButtonElement>(ITEMS)].filter((item) => item.closest('[role="menu"]') === list);
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

/** A submenu that would run past the window's right edge opens to the left of its row instead. */
function flipIfOffscreen(node: HTMLDivElement | null) {
  if (node !== null && node.getBoundingClientRect().right > window.innerWidth - EDGE) node.classList.add('menu--sub-left');
}

function itemClass(entry: { isDanger?: boolean }, isOpen = false): string {
  return ['menu__item', entry.isDanger === true ? 'menu__item--danger' : '', isOpen ? 'menu__item--open' : ''].filter(Boolean).join(' ');
}

interface ListProps {
  items: MenuEntry[];
  onClose: () => void;
  /** The submenu open now, by index, and its setter (one level only). */
  openSub: number | null;
  setOpenSub: (index: number | null) => void;
}

/** One level's rows; a submenu's rows render inside it, beside its row. */
function Rows({ items, onClose, openSub, setOpenSub }: ListProps) {
  return items.map((item, index) => {
    switch (item.kind) {
      case 'separator':
        return <div key={`separator-${String(index)}`} className="menu__separator" role="separator" />;
      case 'check':
        return (
          <button
            key={item.label}
            type="button"
            role="menuitemcheckbox"
            aria-checked={item.isChecked}
            className="menu__item"
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.swatchClass !== undefined && <span className={`menu__swatch ${item.swatchClass}`} aria-hidden="true" />}
            <span className="menu__label">{item.label}</span>
            {item.isChecked && (
              <span className="menu__check" aria-hidden="true">
                <Icon name="check" size="xs" />
              </span>
            )}
          </button>
        );
      case 'submenu': {
        const isOpen = openSub === index;
        return (
          <div
            key={item.label}
            className="menu__sub-host"
            onMouseEnter={() => {
              setOpenSub(index);
            }}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              className={itemClass({}, isOpen)}
              onClick={() => {
                setOpenSub(index);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight') return;
                event.preventDefault();
                event.stopPropagation();
                const host = event.currentTarget.parentElement;
                setOpenSub(index);
                requestAnimationFrame(() => {
                  host?.querySelector('.menu--sub')?.querySelector<HTMLButtonElement>(ITEMS)?.focus();
                });
              }}
            >
              <span className="menu__label">{item.label}</span>
              <Icon name="chevron-right" size="xs" />
            </button>
            {isOpen && (
              <div
                ref={flipIfOffscreen}
                className="menu menu--sub"
                role="menu"
                aria-label={item.label}
                onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpenSub(null);
                    event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(':scope > [role="menuitem"]')?.focus();
                  }
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    event.stopPropagation();
                    moveFocus(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
                  }
                }}
              >
                <Rows items={item.items} onClose={onClose} openSub={null} setOpenSub={() => undefined} />
              </div>
            )}
          </div>
        );
      }
      case 'item':
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={itemClass(item)}
            disabled={item.isDisabled === true}
            onMouseEnter={() => {
              setOpenSub(null);
            }}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {item.icon !== undefined && <Icon name={item.icon} size="xs" />}
            <span className="menu__label">{item.label}</span>
            {item.hint !== undefined && <kbd className="menu__hint">{item.hint}</kbd>}
          </button>
        );
    }
  });
}

/**
 * The menu.
 * @param props - See `MenuProps`.
 * @returns The menu, or nothing while closed.
 */
export function Menu({ anchor, label, items, onClose, className }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [corner, setCorner] = useState<Point | null>(null);
  // The open submenu belongs to the anchor it was opened at, so a new opening starts closed.
  const [sub, setSub] = useState<{ at: MenuAnchor; index: number } | null>(null);
  const openSub = sub !== null && sub.at === anchor ? sub.index : null;
  const setOpenSub = (index: number | null) => {
    setSub(index === null || anchor === null ? null : { at: anchor, index });
  };
  useDismiss(ref, anchor !== null, onClose);

  useLayoutEffect(() => {
    const menu = ref.current;
    if (anchor === null || menu === null) return;
    setCorner(cornerFor(anchor, menu));
    menu.querySelector<HTMLButtonElement>(ITEMS)?.focus();
  }, [anchor]);

  if (anchor === null) return null;
  return (
    <div
      ref={ref}
      className={className === undefined ? 'menu' : `menu ${className}`}
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
      <Rows items={items} onClose={onClose} openSub={openSub} setOpenSub={setOpenSub} />
    </div>
  );
}
