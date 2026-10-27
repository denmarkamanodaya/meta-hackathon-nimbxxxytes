// The nimbytes wordmark: the cloud-and-bytes mark and the name in the display face.
import { LogoMark } from './LogoMark';
import './Wordmark.css';

/** Mark size in the header, px. */
const MARK_PX = 32;

/**
 * Brand mark and name.
 * @returns The wordmark.
 */
export function Wordmark() {
  return (
    <span className="wordmark">
      <LogoMark size={MARK_PX} className="wordmark__mark" />
      <span className="wordmark__name">nimbytes</span>
    </span>
  );
}
