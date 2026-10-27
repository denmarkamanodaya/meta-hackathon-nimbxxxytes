// BottomBar primitive: the fixed action bar of a full-screen page, with an optional muted note
// above its buttons. Beside the sidebar in the Mac app.
import type { ReactNode } from 'react';
import './BottomBar.css';

/** Props for `BottomBar`. */
export interface BottomBarProps {
  /** One muted line above the buttons. */
  note?: string;
  /** The buttons; two share the width, the second wider. */
  children: ReactNode;
}

/**
 * The bar.
 * @param props - See `BottomBarProps`.
 * @returns The bar.
 */
export function BottomBar({ note, children }: BottomBarProps) {
  return (
    <div className="bottom-bar">
      {note !== undefined && <p className="bottom-bar__note">{note}</p>}
      <div className="bottom-bar__actions">{children}</div>
    </div>
  );
}
