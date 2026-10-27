// Where a pop-up menu goes: under the ⋯ button (right edges aligned), or at the pointer for a
// right-click, always kept inside the window with a margin.

/** A point in window coordinates, px. */
export interface Point {
  x: number;
  y: number;
}

/** A box in window coordinates, px. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a menu opens: under a button, or at a point (right-click). */
export type MenuAnchor = { kind: 'button'; box: Box } | { kind: 'point'; point: Point };

/**
 * The menu's top-left corner for a menu opened from a button: right edges aligned, just below.
 * @param button - The button's box.
 * @param menuWidth - The menu's width.
 * @param gap - Space between button and menu.
 * @returns The corner (not yet clamped).
 */
export function belowButton(button: Box, menuWidth: number, gap: number): Point {
  return { x: button.right - menuWidth, y: button.bottom + gap };
}

/**
 * Keeps a menu inside the window: moves it left or up when it would overflow, never past the margin.
 * @param corner - Wanted top-left corner.
 * @param size - Menu width and height.
 * @param window - Window width and height.
 * @param margin - Smallest distance to every window edge.
 * @returns The corner to use.
 */
export function clampMenu(
  corner: Point,
  size: { width: number; height: number },
  window: { width: number; height: number },
  margin: number,
): Point {
  const maxX = Math.max(margin, window.width - size.width - margin);
  const maxY = Math.max(margin, window.height - size.height - margin);
  return { x: Math.min(Math.max(corner.x, margin), maxX), y: Math.min(Math.max(corner.y, margin), maxY) };
}
