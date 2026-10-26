import { describe, expect, it } from 'vitest';
import { humanizeDetail, humanizeNote, shotNames } from './humanize';

const shot = (segment_id: string, subject: string | null) => ({
  segment_id,
  in: 0,
  out: 1,
  subject,
  punch_in: 1,
  reason: 'r',
});

const v1 = [shot('seg_coffee', 'the latte pour'), shot('seg_street', null), shot('seg_street_2', null), shot('seg_desk', 'laptop opening')];
const v2 = [shot('seg_coffee', 'the latte pour'), shot('seg_street', null), shot('seg_crossing', 'the crossing'), shot('seg_desk', 'laptop opening')];

describe('humanizeDetail', () => {
  const names = shotNames([v2, v1]);

  it('names a trim by subject with start/end and m:ss.s times', () => {
    expect(humanizeDetail('seg_desk out 64.0 → 63.5', names)).toBe('laptop opening: end 1:04.0 → 1:03.5');
    expect(humanizeDetail('seg_coffee in 2.0 → 3.0', names)).toBe('the latte pour: start 0:02.0 → 0:03.0');
  });

  it('leaves times already written as m:ss alone (no "0:0:07.5")', () => {
    expect(humanizeDetail('from 0:07.5 to 0:12.4', names)).toBe('from 0:07.5 to 0:12.4');
    expect(humanizeDetail('at 1:02:03.5', names)).toBe('at 1:02:03.5');
  });

  it('converts bare seconds written with an "s"', () => {
    expect(humanizeDetail('held 7.5 s', names)).toBe('held 0:07.5');
  });

  it('names a swap, using "Shot N" from the older version for a removed shot without subject', () => {
    expect(humanizeDetail('seg_street_2 → seg_crossing', names)).toBe('Shot 3 → the crossing');
  });

  it('does not confuse an id with a longer id that starts the same', () => {
    expect(humanizeDetail('moved seg_street', names)).toBe('moved Shot 2');
  });

  it('matches the longest id first when ids contain hyphens (UUIDs)', () => {
    const hyphenated = shotNames([[shot('0192-a', 'pour'), shot('0192-a-b', 'walk')]]);

    expect(humanizeDetail('0192-a-b → 0192-a', hyphenated)).toBe('walk → pour');
  });

  it("prefers this version's subject over the older one for the same shot", () => {
    const names2 = shotNames([[shot('seg_desk', 'laptop opening')], [shot('seg_desk', 'desk')]]);

    expect(humanizeDetail('seg_desk out 64.0 → 63.5', names2)).toBe('laptop opening: end 1:04.0 → 1:03.5');
  });
});

describe('humanizeNote', () => {
  const kangarooId = '01a179c0-1f2b-7c11-9e3a-2b4c5d6e7f80-s1';
  const names = shotNames(
    [[shot('seg_a', 'supercar stroll')]],
    [{ segment_id: kangarooId, description: 'A kangaroo stands under the bus shelter roof' }],
  );

  it('rewrites the live critique note: id → segment words, seconds range → m:ss–m:ss', () => {
    expect(humanizeNote(`Join ${kangarooId} 7.0-12.4 as one shot`, names)).toBe(
      'Join A kangaroo stands under 0:07–0:12 as one shot',
    );
  });

  it('turns field names into words', () => {
    expect(humanizeNote('tighter punch_in on the hook', names)).toBe('tighter zoom on the hook');
  });

  it('hides an id it cannot name', () => {
    expect(humanizeNote('Swap 01a179c0-9999-7000-8000-000000000000-s4 for a wider shot', names)).toBe(
      'Swap another shot for a wider shot',
    );
  });

  it('keeps in/out as plain words after a shot name in notes', () => {
    expect(humanizeNote('seg_a out 9.0 is abrupt', names)).toBe('supercar stroll out 0:09.0 is abrupt');
  });

  it('prefers a clip subject over the segment description', () => {
    const both = shotNames([[shot('s1', 'kangaroo')]], [{ segment_id: 's1', description: 'A kangaroo under a roof' }]);

    expect(humanizeNote('s1 holds too long', both)).toBe('kangaroo holds too long');
  });
});
