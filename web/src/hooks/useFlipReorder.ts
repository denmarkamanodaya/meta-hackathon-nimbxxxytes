// Moves list items smoothly to their new place when the list reorders (the Search results going
// from the local order to the Muse Spark order), and fades in items that are new. Items carry
// `data-flip-key`. Duration and easing come from the motion tokens, which are 0 ms under
// prefers-reduced-motion, so reduced motion gets no animation at all.
import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Reads a `--motion-*` token ("220ms") as milliseconds; 0 when missing. */
function tokenMs(style: CSSStyleDeclaration, name: string): number {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

/** Each keyed item's top relative to the list, so page scroll between renders does not count. */
function measure(list: HTMLElement): Map<string, { item: HTMLElement; top: number }> {
  const origin = list.getBoundingClientRect().top;
  const out = new Map<string, { item: HTMLElement; top: number }>();
  for (const item of list.querySelectorAll<HTMLElement>('[data-flip-key]')) {
    const key = item.dataset.flipKey;
    if (key !== undefined) out.set(key, { item, top: item.getBoundingClientRect().top - origin });
  }
  return out;
}

/**
 * Animates the items of `list` whenever `order` changes.
 * @param list - The list element.
 * @param order - The item keys in order, joined; a change triggers the animation.
 */
export function useFlipReorder(list: RefObject<HTMLElement | null>, order: string): void {
  const before = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    const now = measure(root);
    const previous = before.current;
    before.current = new Map([...now].map(([key, { top }]) => [key, top]));
    const style = getComputedStyle(root);
    const duration = tokenMs(style, '--motion-base');
    if (previous === null || duration === 0) return;
    const easing = style.getPropertyValue('--ease-standard').trim() || 'ease';
    for (const [key, { item, top }] of now) {
      if (typeof item.animate !== 'function') continue;
      const from = previous.get(key);
      if (from === undefined) item.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing });
      else if (from !== top) {
        item.animate([{ transform: `translateY(${String(from - top)}px)` }, { transform: 'none' }], { duration, easing });
      }
    }
  }, [list, order]);
}
