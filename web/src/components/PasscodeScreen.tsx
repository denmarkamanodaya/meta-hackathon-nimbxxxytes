// Passcode screen for the demo session; the shell shows it after any 401.
import { useState } from 'react';
import { Button } from '../design/Button';
import { Card } from '../design/Card';
import { Icon } from '../design/Icon';
import { useUnlock } from '../hooks/useSession';
import './PasscodeScreen.css';

/**
 * Brand mark, passcode field and unlock button. Paste and password managers work
 * (`autocomplete="current-password"`).
 * @returns The screen.
 */
export function PasscodeScreen() {
  const { state, unlock } = useUnlock();
  const [passcode, setPasscode] = useState('');
  const isSubmitting = state.status === 'submitting';

  return (
    <main className="passcode-screen">
      <div className="passcode-screen__brand">
        <span className="passcode-screen__mark">
          <Icon name="cloud" size="lg" />
        </span>
        <h1 className="passcode-screen__title">nimbytes</h1>
        <p className="passcode-screen__tagline">Your glasses footage, understood.</p>
      </div>
      <Card>
        <form
          className="passcode-screen__form"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock(passcode);
          }}
        >
          <label className="passcode-screen__label" htmlFor="passcode">
            Demo passcode
          </label>
          <input
            id="passcode"
            className="passcode-screen__input"
            type="password"
            autoComplete="current-password"
            required
            value={passcode}
            aria-invalid={state.status === 'error'}
            aria-describedby={state.status === 'error' ? 'passcode-error' : undefined}
            onChange={(event) => {
              setPasscode(event.target.value);
            }}
          />
          {state.status === 'error' && (
            <p id="passcode-error" className="passcode-screen__error" role="alert">
              {state.message}
            </p>
          )}
          <Button type="submit" disabled={isSubmitting || passcode === ''}>
            {isSubmitting ? 'Unlocking…' : 'Unlock'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
