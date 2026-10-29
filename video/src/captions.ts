// Word-by-word captions: each line's words, timed across its spoken length by their length (a
// pause after commas and full stops). The word being spoken is in the accent colour. Pure.
import { LINES, type Line } from './timeline';

/** One timed word, in frames from the start of the video. */
export interface Word {
  text: string;
  from: number;
  to: number;
}

/** Extra weight for a word that ends a clause, so the next word waits as the voice does. */
const pauseWeight = (word: string): number => (/[.!?]$/.test(word) ? 3 : /[,;:]$/.test(word) ? 1.5 : 0);

/**
 * Times a line's words across its length.
 * @param line - The placed line.
 * @returns Its words.
 */
export function wordsOf(line: Line): Word[] {
  const words = line.text.split(' ');
  const weights = words.map((word) => word.replace(/[^\p{L}\p{N}]/gu, '').length + 1.2 + pauseWeight(word));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let at = line.from;
  return words.map((text, index) => {
    const length = (line.durationInFrames * (weights[index] ?? 0)) / total;
    const word = { text, from: Math.round(at), to: Math.round(at + length) };
    at += length;
    return word;
  });
}

/**
 * The line showing at a frame, with its words.
 * @param frame - Frame of the video.
 * @returns The line and its words, or undefined between lines (a line stays 12 frames after it ends).
 */
export function captionAt(frame: number): { line: Line; words: Word[] } | undefined {
  const line = LINES.find((l) => frame >= l.from && frame < l.from + l.durationInFrames + 12);
  return line === undefined ? undefined : { line, words: wordsOf(line) };
}
