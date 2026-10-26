import { afterEach, describe, expect, it } from 'vitest';
import type { AgentStep } from '../services/api/types';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { AgentSteps } from './AgentSteps';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const step = (seq: number, tool: string, summary: string): AgentStep => ({
  seq,
  kind: 'tool_call',
  tool,
  version: 1,
  summary,
  at: '2026-11-01T09:00:00Z',
});

describe('AgentSteps', () => {
  it('drops a summary that repeats the label and keeps one that adds detail', async () => {
    view = await mount(
      <AgentSteps
        steps={[step(1, 'critique_preview', 'Watching v1'), step(2, 'render_preview', 'Rendering a 540p preview')]}
        isWorking={false}
      />,
      fakeServices(),
    );

    const summaries = [...view.container.querySelectorAll('.agent-steps__summary')].map((el) => el.textContent);
    expect(summaries).toEqual(['Rendering a 540p preview']);
  });
});
