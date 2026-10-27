import { describe, expect, it } from 'vitest';
import costs from '../test-support/fixtures/costs.json';
import { costRows } from './cost-rows';

describe('costRows', () => {
  it('lists the four Meta models in the screen order, by their versioned ids', () => {
    expect(costRows(costs)).toEqual([
      { label: 'Muse Spark (titles, search, editing)', costUsd: 0.0611 },
      { label: 'SAM 3.1 (faces)', costUsd: 0.0048 },
      { label: 'Voice Transcribe (speech)', costUsd: 0.0183 },
      { label: 'Muse Image (storyboards, covers)', costUsd: 0 },
    ]);
  });

  it('adds up versions of one model, and lists an id no row covers on its own line', () => {
    const rows = costRows({
      total_usd: 0.6,
      by_model: [
        { model: 'muse-image-1.0', calls: 2, cost_usd: 0.2 },
        { model: 'muse-image-1.1', calls: 1, cost_usd: 0.1 },
        { model: 'samurai', calls: 1, cost_usd: 0.3 },
      ],
    });

    expect(rows.find((r) => r.label.startsWith('Muse Image'))?.costUsd).toBeCloseTo(0.3);
    expect(rows.find((r) => r.label.startsWith('SAM'))?.costUsd).toBe(0);
    expect(rows.at(-1)).toEqual({ label: 'samurai', costUsd: 0.3 });
  });
});
