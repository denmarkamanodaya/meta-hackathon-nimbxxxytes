import { describe, expect, it } from 'vitest';
import { clipDeleteCopy, productionDeleteCopy } from './delete-copy';

describe('productionDeleteCopy', () => {
  it('names the production and says the clips stay, as in V10b', () => {
    expect(productionDeleteCopy('Sixty and shining')).toEqual({
      title: 'Delete “Sixty and shining”?',
      body: 'This removes its shot list, storyboards and coverage. Your clips stay in the Gallery.',
      confirmLabel: 'Delete',
    });
  });
});

describe('clipDeleteCopy', () => {
  it('names the one clip, as in mock V3', () => {
    expect(clipDeleteCopy(['Kangaroo at bus stop'])).toEqual({
      title: 'Delete this clip?',
      body: '“Kangaroo at bus stop” and its moments, faces and transcript are removed from nimbytes on every device. Shorts that used it keep their render but can’t be re-cut with it. This can’t be undone.',
      confirmLabel: 'Delete clip',
    });
  });

  it('counts several clips', () => {
    expect(clipDeleteCopy(['a', 'b', 'c'])).toMatchObject({ title: 'Delete 3 clips?', confirmLabel: 'Delete 3 clips' });
    expect(clipDeleteCopy(['a', 'b', 'c']).body).toContain('These 3 clips');
  });
});
