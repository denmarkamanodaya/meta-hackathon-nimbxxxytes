import { describe, expect, it } from 'vitest';
import { libraryQueryPath } from './library-query';

describe('libraryQueryPath', () => {
  it('puts the query on the Library, encoded', () => {
    expect(libraryQueryPath('Sam & the dog')).toBe('/?q=Sam+%26+the+dog');
  });

  it('goes to the plain Library for no query or a blank one', () => {
    expect(libraryQueryPath(null)).toBe('/');
    expect(libraryQueryPath('  ')).toBe('/');
  });
});
