import { describe, expect, it } from 'vitest';
import { splitUtterances } from './utterances';

describe('splitUtterances', () => {
  it('cuts at sentence ends and line breaks, keeping amounts whole', () => {
    expect(splitUtterances('Your bill is $142.60. Pay by Friday!\nAccount 12\n\nThanks?')).toEqual([
      'Your bill is $142.60.',
      'Pay by Friday!',
      'Account 12',
      'Thanks?',
    ]);
  });

  it('keeps a closing quote or bracket with its sentence and single-spaces it', () => {
    expect(splitUtterances('He said "stop."   Then  (we left.) Done')).toEqual(['He said "stop."', 'Then (we left.)', 'Done']);
  });

  it('cuts a long sentence at a comma, else a space, never past max', () => {
    expect(splitUtterances('one two three, four five six seven eight', 20)).toEqual(['one two three,', 'four five six seven', 'eight']);
    for (const part of splitUtterances('word '.repeat(80), 30)) expect(part.length).toBeLessThanOrEqual(30);
  });

  it('cuts a word longer than max at max', () => {
    expect(splitUtterances('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('has nothing to say for blank text', () => {
    expect(splitUtterances('  \n ')).toEqual([]);
  });
});
