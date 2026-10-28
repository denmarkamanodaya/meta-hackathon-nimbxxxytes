import { afterEach, describe, expect, it } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { CutoutView } from './CutoutView';

const cutout = { label: 'mug', png_url: '/c.png', sticker_url: '/s.png' };
let view: Mounted | null = null;
afterEach(() => {
  view?.unmount();
  view = null;
});

const titles = (root: HTMLElement) => root.textContent.split('Cut out · mug').length - 1;

describe('CutoutView', () => {
  it('titles itself in the Mac dialog', async () => {
    view = await mount(<CutoutView cutout={cutout} atS={12} buttonClass="b" primaryClass="p" />, fakeServices());

    expect(titles(view.container)).toBe(1);
    expect(view.container.textContent).toContain('From 0:12');
  });

  it('leaves the title to the sheet that already shows it, keeping where it is from', async () => {
    view = await mount(<CutoutView cutout={cutout} atS={12} hasTitle={false} buttonClass="b" primaryClass="p" />, fakeServices());

    expect(titles(view.container)).toBe(0);
    expect(view.container.textContent).toContain('From 0:12');
  });
});
