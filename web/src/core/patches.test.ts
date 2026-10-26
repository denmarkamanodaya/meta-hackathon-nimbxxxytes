import { describe, expect, it } from 'vitest';
import { applyPatches } from './patches';

describe('applyPatches', () => {
  const rows = [
    { id: 'a', name: null as string | null, hidden: false },
    { id: 'b', name: 'Sam', hidden: false },
  ];

  it('merges a patch into its row only', () => {
    const out = applyPatches(rows, new Map([['a', { name: 'Ana' }]]), (r) => r.id);

    expect(out).toEqual([
      { id: 'a', name: 'Ana', hidden: false },
      { id: 'b', name: 'Sam', hidden: false },
    ]);
    expect(out[1]).toBe(rows[1]);
  });

  it('ignores patches for rows that are not in the list', () => {
    expect(applyPatches(rows, new Map([['zz', { hidden: true }]]), (r) => r.id)).toEqual(rows);
  });
});
