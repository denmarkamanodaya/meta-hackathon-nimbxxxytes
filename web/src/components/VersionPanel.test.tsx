import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseShortDetail } from '../services/api/parse-shorts';
import fixture from '../test-support/fixtures/short.json';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { VersionPanel } from './VersionPanel';

const detail = parseShortDetail(fixture);
if (detail === null) throw new Error('short.json fixture does not parse');
const [v1, v2, v3] = detail.versions;
if (v1 === undefined || v2 === undefined || v3 === undefined) throw new Error('fixture needs 3 versions');

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const render = (version: typeof v1, isWorking = false) =>
  mount(
    <VersionPanel
      version={version}
      versions={detail.versions}
      aspect="4:5"
      startSeconds={null}
      onShowNote={vi.fn()}
      playerProps={null}
      isWorking={isWorking}
    />,
    fakeServices(),
  );

describe('VersionPanel', () => {
  it('reads rationale, then what changed, then the scores, then the findings', async () => {
    view = await render(v2);
    const text = view.container.textContent;

    const order = [v2.timeline.rationale, 'What changed from v1', '/50', 'What the critique found'].map((part) =>
      text.indexOf(part),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('shows changes in people words, never raw segment ids', async () => {
    view = await render(v2);
    const text = view.container.textContent;

    expect(text).toContain('Shot 3 → the crossing');
    expect(text).toContain('the latte pour: start 0:02.0 → 0:03.0');
    expect(text).not.toMatch(/seg_/);
  });

  it('shows the score change since the previous version', async () => {
    view = await render(v2);

    expect(view.container.querySelector('.score-bars__total')?.textContent).toBe('39/50+7');
    expect(view.container.querySelector('.score-bars__delta--up')).not.toBeNull();
  });

  it('shows no deltas on v1', async () => {
    view = await render(v1);

    expect(view.container.querySelector('.score-bars__delta')).toBeNull();
  });

  it('says the cut was accepted instead of an empty findings list', async () => {
    view = await render(v3);
    const text = view.container.textContent;

    expect(text).toContain('No issues left — the editor accepted this cut.');
    expect(view.container.querySelector('.version-panel__notes')).toBeNull();
  });

  it('shows a spinner for a missing critique only while the short is still working', async () => {
    const uncritiqued = { ...v1, critique: null, score_total: null, preview_url: null };

    view = await render(uncritiqued, true);
    expect(view.container.textContent).toContain('Watching the preview…');
    expect(view.container.querySelector('.spinner')).not.toBeNull();
    view.unmount();

    view = await render(uncritiqued, false);
    expect(view.container.textContent).toContain('Not critiqued yet');
    expect(view.container.textContent).toContain('No preview for this version');
    expect(view.container.textContent).not.toContain('Watching the preview');
    expect(view.container.querySelector('.spinner')).toBeNull();
  });
});

