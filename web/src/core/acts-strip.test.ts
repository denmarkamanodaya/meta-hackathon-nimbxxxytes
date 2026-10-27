import { describe, expect, it } from 'vitest';
import type { ActShot } from '../services/api/types';
import { actsStrip } from './acts-strip';

const shot = (ord: number, act: ActShot['act'], segment_id: string | null): ActShot => ({
  ord,
  act,
  title: `Shot ${String(ord)}`,
  duration_s: 4,
  segment_id,
});

describe('actsStrip', () => {
  const plan = [shot(1, 'hook', 's1'), shot(2, 'story', 's2'), shot(3, 'payoff', null), shot(4, 'outro', 's4')];

  it('lays the cut out in cut order, sized by length, named by the planned shot', () => {
    const strip = actsStrip(
      [
        { segment_id: 's2', in: 0, out: 6 },
        { segment_id: 's1', in: 10, out: 12 },
      ],
      plan,
    );

    expect(strip.length_s).toBe(8);
    expect(strip.parts).toEqual([
      { act: 'story', title: 'Shot 2', start_s: 0, end_s: 6, share: 0.75 },
      { act: 'hook', title: 'Shot 1', start_s: 6, end_s: 8, share: 0.25 },
    ]);
  });

  it('marks a shot the editor added on its own as not in the plan', () => {
    const strip = actsStrip([{ segment_id: 'extra', in: 0, out: 3 }], plan);

    expect(strip.parts[0]).toMatchObject({ act: null, title: null });
  });

  it('lists planned shots that were never filmed or that the cut dropped, in play order', () => {
    const strip = actsStrip([{ segment_id: 's1', in: 0, out: 3 }], plan);

    expect(strip.missing.map((s) => s.ord)).toEqual([2, 3, 4]);
  });

  it('gives an empty cut no widths', () => {
    expect(actsStrip([], plan)).toMatchObject({ parts: [], length_s: 0 });
  });
});
