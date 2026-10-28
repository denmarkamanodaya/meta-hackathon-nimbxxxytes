import { describe, expect, it, vi } from 'vitest';
import { createImageCopier } from './copy-image';

const png = 'image/png';
const answer = (type: string, status = 200) =>
  vi.fn<typeof fetch>().mockResolvedValue(new Response('x', { status, headers: { 'Content-Type': type } }));
const makeItem = (items: Record<string, Blob>) => items as unknown as ClipboardItem;

describe('createImageCopier', () => {
  it('puts the PNG on the clipboard', async () => {
    const write = vi.fn(() => Promise.resolve());
    const copyText = vi.fn(() => Promise.resolve(true));
    const copy = createImageCopier({ clipboard: { write }, makeItem, fetchFn: answer(png), copyText });

    await expect(copy('/c.png')).resolves.toBe('image');
    expect(write).toHaveBeenCalledWith([{ 'image/png': expect.anything() as Blob }]);
    expect(copyText).not.toHaveBeenCalled();
  });

  it('copies the link without image clipboard support, or for a non-PNG', async () => {
    const copyText = vi.fn(() => Promise.resolve(true));
    const noItems = createImageCopier({ clipboard: undefined, makeItem: undefined, fetchFn: answer(png), copyText });
    await expect(noItems('/c.png')).resolves.toBe('link');

    const write = vi.fn(() => Promise.resolve());
    const svg = createImageCopier({ clipboard: { write }, makeItem, fetchFn: answer('image/svg+xml'), copyText });
    await expect(svg('/c.svg')).resolves.toBe('link');
    expect(write).not.toHaveBeenCalled();
  });

  it('falls back to the link when writing is refused, and fails when that is refused too', async () => {
    const write = vi.fn(() => Promise.reject(new Error('denied')));
    const copied = createImageCopier({ clipboard: { write }, makeItem, fetchFn: answer(png), copyText: () => Promise.resolve(true) });
    await expect(copied('/c.png')).resolves.toBe('link');

    const none = createImageCopier({ clipboard: { write }, makeItem, fetchFn: answer(png), copyText: () => Promise.resolve(false) });
    await expect(none('/c.png')).resolves.toBe('failed');
  });
});
