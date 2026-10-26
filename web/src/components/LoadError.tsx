// Screen-level load failure: what went wrong, the code, and Retry (polling also retries).
import { loadErrorView } from '../core/load-error';
import { Button } from '../design/Button';
import { EmptyState } from '../design/EmptyState';

/** Props for `LoadError`. */
export interface LoadErrorProps {
  error: unknown;
  /** What was being loaded, for example "short". */
  thing: string;
  onRetry: () => void;
}

/**
 * Empty state for a failed load.
 * @param props - See `LoadErrorProps`.
 * @returns The empty state, with Retry when retrying can help.
 */
export function LoadError({ error, thing, onRetry }: LoadErrorProps) {
  const view = loadErrorView(error, thing);
  return (
    <div role="alert">
      <EmptyState
        icon="offline"
        title={view.title}
        body={`${view.body} (${view.code})`}
        action={
          view.canRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
