// Mac app sign-in (mock M4, as ruled 2026-10-27: server and folder are fixed, never asked): the
// logo, title and the "AI-powered filesystem" tagline on the shared sign-in backdrop, the passcode, "Sign in and start syncing" (POST /session through the
// native transport) and the Keychain note. Shown in place of the passcode screen while the
// session is locked.
import { useState } from 'react';
import { Button } from '../../design/Button';
import { LoginBackdrop } from '../../design/LoginBackdrop';
import { LogoMark } from '../../design/LogoMark';
import { Spinner } from '../../design/Spinner';
import { useUnlock } from '../../hooks/useSession';
import './MacFirstRun.css';

/** Mark size on the sign-in screen (M4), px. */
const MARK_PX = 72;

/**
 * The screen.
 * @returns The main element.
 */
export function MacFirstRun() {
  const { state, unlock } = useUnlock();
  const [passcode, setPasscode] = useState('');
  const isSubmitting = state.status === 'submitting';
  return (
    <LoginBackdrop>
      <main className="mac-first-run">
        <LogoMark size={MARK_PX} />
        <div className="mac-first-run__intro">
          <h1 className="mac-first-run__title">nimbytes for Mac</h1>
          <p className="mac-first-run__tagline">AI-powered filesystem</p>
        </div>
        <form
          className="mac-first-run__form"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock(passcode);
          }}
        >
          <div className="mac-first-run__field">
            <label className="mac-first-run__label" htmlFor="mac-passcode">
              Passcode
            </label>
            <input
              id="mac-passcode"
              className="mac-first-run__input"
              type="password"
              autoComplete="current-password"
              required
              value={passcode}
              aria-invalid={state.status === 'error'}
              aria-describedby={state.status === 'error' ? 'mac-passcode-error' : undefined}
              onChange={(event) => {
                setPasscode(event.target.value);
              }}
            />
          </div>
          {state.status === 'error' && (
            <p id="mac-passcode-error" className="mac-first-run__error" role="alert">
              {state.message}
            </p>
          )}
          <Button type="submit" size="lg" disabled={isSubmitting || passcode === ''}>
            {isSubmitting && <Spinner />}
            Sign in and start syncing
          </Button>
          <span className="mac-first-run__note">Your session is kept in the macOS Keychain.</span>
        </form>
      </main>
    </LoginBackdrop>
  );
}
