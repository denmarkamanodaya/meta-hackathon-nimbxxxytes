// Mac app first run and locked session (mock M4): server URL, passcode and the sync folder (with
// Choose…), then "Sign in and start syncing" saves the server, moves the folder if changed and
// signs in. Shown in place of the passcode screen.
import { useState } from 'react';
import { displayFolder } from '../../core/desktop-sync';
import { Button } from '../../design/Button';
import { LogoMark } from '../../design/LogoMark';
import { Spinner } from '../../design/Spinner';
import { useFirstRun, type FirstRunState } from '../../hooks/useDesktop';
import './MacFirstRun.css';

/** Mark size on the first-run screen (M4), px. */
const MARK_PX = 72;

type Loaded = Exclude<FirstRunState, { status: 'loading' }>;

function Form({ state, flow }: { state: Loaded; flow: ReturnType<typeof useFirstRun> }) {
  const { chooseFolder, submit } = flow;
  const [server, setServer] = useState(state.server);
  const [passcode, setPasscode] = useState('');
  const { folder } = state;
  const isSubmitting = state.status === 'submitting';
  return (
    <form
      className="mac-first-run__form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit({ server, passcode, folder });
      }}
    >
      <div className="mac-first-run__field">
        <label className="mac-first-run__label" htmlFor="mac-server">
          Server
        </label>
        <input
          id="mac-server"
          className="mac-first-run__input"
          type="url"
          inputMode="url"
          autoComplete="url"
          required
          placeholder="https://"
          value={server}
          onChange={(event) => {
            setServer(event.target.value);
          }}
        />
      </div>
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
          onChange={(event) => {
            setPasscode(event.target.value);
          }}
        />
      </div>
      <div className="mac-first-run__field">
        <label className="mac-first-run__label" htmlFor="mac-folder">
          Folder
        </label>
        <div className="mac-first-run__folder">
          <input id="mac-folder" className="mac-first-run__input mac-first-run__input--mono" readOnly value={displayFolder(folder)} />
          <Button
            variant="secondary"
            onClick={() => {
              void chooseFolder();
            }}
          >
            Choose…
          </Button>
        </div>
      </div>
      {state.status === 'error' && (
        <p className="mac-first-run__error" role="alert">
          {state.message}
        </p>
      )}
      <Button type="submit" size="lg" disabled={isSubmitting || server === '' || passcode === ''}>
        {isSubmitting && <Spinner />}
        Sign in and start syncing
      </Button>
      <span className="mac-first-run__note">Your session is kept in the macOS Keychain.</span>
    </form>
  );
}

/**
 * The screen.
 * @returns The main element.
 */
export function MacFirstRun() {
  const flow = useFirstRun();
  return (
    <main className="mac-first-run">
      <LogoMark size={MARK_PX} />
      <div className="mac-first-run__intro">
        <h1 className="mac-first-run__title">nimbytes for Mac</h1>
        <p className="mac-first-run__tagline">
          Your cloud library as a real folder: play from disk, edit in Final Cut or Resolve, drop finished cuts back in.
        </p>
      </div>
      {flow.state.status === 'loading' ? <Spinner /> : <Form state={flow.state} flow={flow} />}
    </main>
  );
}
