// The phone step view's Back: on step 2 it goes to step 1, and on step 1 it returns to the guide
// page instead of sitting disabled, so the full-screen view (no tab bar) always has a way out.
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../services/api/client';
import { parseGuide } from '../services/api/parse-guides';
import type { Guide } from '../services/api/types';
import guideJson from '../test-support/fixtures/guide.json';
import { fakeApi, fakeServices, mount, type Mounted } from '../test-support/services';
import { GuideStepPage } from './GuideStepPage';

let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const parsed = parseGuide(guideJson);
if (parsed === null) throw new Error('guide fixture does not parse');
const GUIDE: Guide = parsed;

async function showStep(n: number) {
  const getGuide = vi.fn<ApiClient['getGuide']>().mockResolvedValue(GUIDE);
  view = await mount(
    <MemoryRouter initialEntries={[`/guides/g_kettle/step/${String(n)}`]}>
      <Routes>
        <Route path="/guides/:id/step/:n" element={<GuideStepPage />} />
        <Route path="/guides/:id" element={<p>Guide page</p>} />
      </Routes>
    </MemoryRouter>,
    fakeServices({ api: fakeApi({ getGuide }) }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  return { container: view.container };
}

async function pressBack(container: HTMLElement) {
  const back = container.querySelector<HTMLButtonElement>('.guide-step__back');
  if (back === null) throw new Error('no Back button');
  expect(back.disabled).toBe(false);
  await act(async () => {
    back.click();
    await Promise.resolve();
  });
}

describe('Back in the phone step view', () => {
  it('goes to the step before', async () => {
    const { container } = await showStep(2);

    await pressBack(container);

    expect(container.querySelector('.guide-step__count')?.textContent).toBe('Step 1 of 4');
  });

  it('returns to the guide page from the first step', async () => {
    const { container } = await showStep(1);

    await pressBack(container);

    expect(container.textContent).toBe('Guide page');
  });
});
