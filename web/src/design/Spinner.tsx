// Spinner primitive: a small indeterminate activity dot ring, still under reduced motion.
import './Spinner.css';

/**
 * Decorative activity indicator; pair it with visible text that says what is happening.
 * @returns The spinner element.
 */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
