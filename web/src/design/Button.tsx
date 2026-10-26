// Button primitive and the class builder links reuse to look like buttons.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

/** Visual weight of a button. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

/**
 * Returns the class list for a button-styled element.
 * @param variant - Visual weight.
 * @returns Space-separated class names.
 */
export function buttonClassName(variant: ButtonVariant): string {
  return `button button--${variant}`;
}

/** Props for `Button`; all native button attributes pass through. */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight; defaults to `primary`. */
  variant?: ButtonVariant;
  /** Label and optional icon. */
  children: ReactNode;
}

/**
 * Touch-sized button (min 44 px). Defaults to `type="button"` so it never submits by accident.
 * @param props - See `ButtonProps`.
 * @returns The button element.
 */
export function Button({ variant = 'primary', type = 'button', children, ...rest }: ButtonProps) {
  return (
    <button {...rest} type={type} className={buttonClassName(variant)}>
      {children}
    </button>
  );
}
