// Incremental `text/event-stream` parser for streams read with fetch (EventSource cannot POST):
// feed decoded text chunks, get whole events back. Comment lines (`:`) and `id` / `retry` fields
// are dropped; callers need only the event name and its data.
import type { StreamEvent } from '../../core/ports/api-transport';

/** Parser state between chunks. */
export interface SseParser {
  /**
   * Adds a chunk of decoded text.
   * @param chunk - Any slice of the stream; events may span chunks.
   * @returns Every event the chunk completed, in order.
   */
  push: (chunk: string) => StreamEvent[];
}

/**
 * Creates a parser with an empty buffer.
 * @returns The parser.
 */
export function createSseParser(): SseParser {
  let buffer = '';
  let event: string | null = null;
  let data: string[] = [];

  const line = (text: string): StreamEvent | null => {
    if (text === '') {
      if (data.length === 0 && event === null) return null;
      const done = { event, data: data.join('\n') };
      event = null;
      data = [];
      return done;
    }
    if (text.startsWith(':')) return null;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    const raw = colon === -1 ? '' : text.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') event = value;
    if (field === 'data') data.push(value);
    return null;
  };

  return {
    push: (chunk) => {
      buffer += chunk;
      const out: StreamEvent[] = [];
      let end = buffer.indexOf('\n');
      while (end !== -1) {
        const next = line(buffer.slice(0, end).replace(/\r$/, ''));
        buffer = buffer.slice(end + 1);
        if (next !== null) out.push(next);
        end = buffer.indexOf('\n');
      }
      return out;
    },
  };
}
