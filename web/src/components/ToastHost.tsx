// Renders the app's toasts above the tab bar: title, short message and the error code.
import { Icon } from '../design/Icon';
import { useToasts } from '../hooks/useAppChrome';
import './ToastHost.css';

/**
 * Toast stack; announced politely, each one dismissible.
 * @returns The region (empty when there are no toasts).
 */
export function ToastHost() {
  const { toasts, store } = useToasts();
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <div className="toast__body">
            <p className="toast__title">{toast.title}</p>
            <p className="toast__text">
              {toast.text}
              {toast.code !== null && <code className="toast__code">{toast.code}</code>}
            </p>
          </div>
          <button
            type="button"
            className="toast__close"
            aria-label="Dismiss"
            onClick={() => {
              store.dismiss(toast.id);
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
