// The editor at work, on the phone and the Mac Short pages: what it is doing now and its live
// steps, while a short is being made.
import { Spinner } from '../design/Spinner';
import type { AgentStep } from '../services/api/types';
import { AgentSteps } from './AgentSteps';
import './ShortWorking.css';

/**
 * The card.
 * @param props - The live steps and the status line ("Checking draft 2").
 * @returns The section.
 */
export function ShortWorking({ steps, label }: { steps: AgentStep[]; label: string }) {
  return (
    <section className="short-working" aria-label="The editor at work">
      <p className="short-working__status" role="status">
        <Spinner /> {label}
      </p>
      <AgentSteps steps={steps} isWorking />
    </section>
  );
}
