// The sign-in backdrop shared by the Mac app's sign-in and the PWA passcode screen.
import type { ReactNode } from 'react';
import './LoginBackdrop.css';

/**
 * The backdrop around a sign-in screen.
 * @param props - The screen.
 * @returns The wrapper.
 */
export function LoginBackdrop({ children }: { children: ReactNode }) {
  return <div className="login-backdrop">{children}</div>;
}
