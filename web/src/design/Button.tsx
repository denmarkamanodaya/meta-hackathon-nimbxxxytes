// Button primitive and the class builder links reuse to look like buttons.
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import './Button.css';

/**
 * Visual weight of a button. `dashed` is the "add" call to action on light ground; `danger`
 * confirms a delete.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dashed' | 'danger';

/** Height: `md` = 44 px (inline actions), `lg` = 52 px (primary calls to action). */
export type ButtonSize = 'md' | 'lg';

/**
 * Returns the class list for a button-styled element.
 * @param variant - Visual weight.
 * @param size - Height; defaults to `md`.
 * @returns Space-separated class names.
 */
export function buttonClassName(variant: ButtonVariant, size: ButtonSize = 'md'): string {
  return `button button--${variant} button--${size}`;
}

/** Props for `Button`; all native button attributes pass through. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight; defaults to `primary`. */
  variant?: ButtonVariant;
  /** Height; defaults to `md`. */
  size?: ButtonSize;
  /** Label and optional icon. */
  children: ReactNode;
  /** The underlying button (to move focus to it). */
  ref?: Ref<HTMLButtonElement>;
}

/**
 * Touch-sized button (min 44 px). Defaults to `type="button"` so it never submits by accident.
 * @param props - See `ButtonProps`.
 * @returns The button element.
 */
export function Button({ variant = 'primary', size = 'md', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={buttonClassName(variant, size)}>
      {children}
    </button>
  );
}
