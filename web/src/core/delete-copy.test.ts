import { describe, expect, it } from 'vitest';
import { clipDeleteCopy } from './delete-copy';

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
