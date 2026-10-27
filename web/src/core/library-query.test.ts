import { describe, expect, it } from 'vitest';
import { libraryQueryPath, librarySearchPath } from './library-query';

describe('libraryQueryPath', () => {
  it('puts the query on the Library, encoded', () => {
    expect(libraryQueryPath('Sam & the dog')).toBe('/?q=Sam+%26+the+dog');
  });

  it('goes to the plain Library for no query or a blank one', () => {
    expect(libraryQueryPath(null)).toBe('/');
    expect(libraryQueryPath('  ')).toBe('/');
  });
});

describe('librarySearchPath', () => {
  it('keeps the query and the project', () => {
    expect(librarySearchPath(' toast ', 'p 1')).toBe('/?q=toast&project=p+1');
  });

  it('leaves out the parts that are empty', () => {
    expect(librarySearchPath('toast', null)).toBe('/?q=toast');
    expect(librarySearchPath('', 'p1')).toBe('/?project=p1');
    expect(librarySearchPath(null, null)).toBe('/');
  });
});
