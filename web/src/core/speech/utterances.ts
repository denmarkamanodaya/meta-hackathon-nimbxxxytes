// Long text cut into sentence-sized utterances (pure). Safari stops a long utterance part way, and a
// queue of short ones makes pause and stop reliable. A sentence ends at `.`, `!` or `?` followed by
// a space or the end (so `$142.60` stays whole), and at every line break (a bill's lines have no
// stops). A sentence longer than `max` is cut at the last comma or semicolon, else the last space.

/** Utterance length the app uses, characters. */
export const UTTERANCE_CHARS = 220;

const CLOSERS = new Set(['"', "'", ')', ']', '”', '’']);

function sentences(text: string): string[] {
  const out: string[] = [];
  let current = '';
  const push = () => {
    const s = current
      .split(/\s+/)
      .filter((word) => word !== '')
      .join(' ');
    if (s !== '') out.push(s);
    current = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (c === '\n') {
      push();
      continue;
    }
    current += c;
    if (c !== '.' && c !== '!' && c !== '?') continue;
    while (CLOSERS.has(text.charAt(i + 1))) {
      i += 1;
      current += text.charAt(i);
    }
    const next = text.charAt(i + 1);
    if (next === '' || /\s/.test(next)) push();
  }
  push();
  return out;
}

function cut(sentence: string, max: number): string[] {
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const head = rest.slice(0, max + 1);
    const pause = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
    const space = head.lastIndexOf(' ');
    const end = pause > 0 ? pause + 1 : space > 0 ? space : max;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest !== '') out.push(rest);
  return out;
}

/**
 * The utterances to queue for `text`, in order.
 * @param text - Any text.
 * @param max - Longest utterance, characters.
 * @returns The utterances; empty when `text` has nothing to say.
 */
export function splitUtterances(text: string, max: number = UTTERANCE_CHARS): string[] {
  return sentences(text).flatMap((sentence) => cut(sentence, max));
}
