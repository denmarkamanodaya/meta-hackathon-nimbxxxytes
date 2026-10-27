import { useRef, type CSSProperties } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeServices, mount, type Mounted } from '../test-support/services';
import { useFlipReorder } from './useFlipReorder';

let view: Mounted | null = null;
const realAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
afterEach(() => {
  view?.unmount();
  view = null;
  vi.restoreAllMocks();
  if (realAnimate === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  else Object.defineProperty(HTMLElement.prototype, 'animate', realAnimate);
});

const ROW_HEIGHT = 100;

function List({ keys, motion }: { keys: string[]; motion: string }) {
  const list = useRef<HTMLUListElement>(null);
  useFlipReorder(list, keys.join(' '));
  return (
    <ul ref={list} style={{ '--motion-base': motion, '--ease-standard': 'linear' } as CSSProperties}>
      {keys.map((key) => (
        <li key={key} data-flip-key={key}>
          {key}
        </li>
      ))}
    </ul>
  );
}

/** Lays rows out 100 px apart by DOM order and records every animate call per key. */
function fakeLayout() {
  const calls: { key: string; frames: Keyframe[] }[] = [];
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const index = this.parentElement === null ? 0 : [...this.parentElement.children].indexOf(this);
    const top = this.tagName === 'LI' ? index * ROW_HEIGHT : 0;
    return { top, bottom: top + ROW_HEIGHT, left: 0, right: 0, width: 0, height: ROW_HEIGHT, x: 0, y: top, toJSON: () => ({}) };
  });
  HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement, frames: Keyframe[]) {
    calls.push({ key: this.dataset.flipKey ?? '', frames });
    return {} as Animation;
  });
  return calls;
}

describe('useFlipReorder', () => {
  it('slides moved items from their old place and fades in new ones', async () => {
    const calls = fakeLayout();
    view = await mount(<List keys={['a', 'b']} motion="220ms" />, fakeServices());
    expect(calls).toEqual([]);

    view.rerender(<List keys={['b', 'a', 'c']} motion="220ms" />);

    expect(calls).toEqual([
      { key: 'b', frames: [{ transform: 'translateY(100px)' }, { transform: 'none' }] },
      { key: 'a', frames: [{ transform: 'translateY(-100px)' }, { transform: 'none' }] },
      { key: 'c', frames: [{ opacity: 0 }, { opacity: 1 }] },
    ]);
  });

  it('does not animate when the motion token is 0 ms (prefers-reduced-motion)', async () => {
    const calls = fakeLayout();
    view = await mount(<List keys={['a', 'b']} motion="0ms" />, fakeServices());

    view.rerender(<List keys={['b', 'a']} motion="0ms" />);

    expect(calls).toEqual([]);
  });
});
