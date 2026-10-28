// The veil over a picture Muse Image is drawing: a spinner and what is being drawn ("Redrawing…",
// "Drawing from your footage…", "Drawing key art…"). Covers, storyboards and key art share it.
import { Spinner } from '../design/Spinner';
import './DrawingVeil.css';

/**
 * The veil; place it inside a positioned box.
 * @param props - What is being drawn.
 * @returns The veil.
 */
export function DrawingVeil({ label }: { label: string }) {
  return (
    <span className="drawing-veil" role="status">
      <Spinner />
      {label}
    </span>
  );
}
