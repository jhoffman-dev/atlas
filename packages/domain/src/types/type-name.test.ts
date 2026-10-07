import { describe, expect, it } from 'vitest';
import {
  freePropertyKey,
  isViewColumn,
  propertyKeyProblem,
  slugifyName,
  typeNameProblem,
} from './type-name.ts';

describe('slugifyName', () => {
  it.each([
    ['Book', 'book'],
    ['Book club', 'book_club'],
    ['  Reading — list!  ', 'reading_list'],
    ['Café', 'cafe'],
    ['2026 goals', '_2026_goals'],
    ['!!!', ''],
  ])('makes %j into %j', (words, slug) => {
    expect(slugifyName(words)).toBe(slug);
  });
});

describe('typeNameProblem', () => {
  const existing = ['task', 'person'];

  it('accepts a fresh identifier', () => {
    expect(typeNameProblem({ name: 'book', existing })).toBeNull();
  });

  it('refuses an empty name', () => {
    expect(typeNameProblem({ name: ' ', existing })).toMatch(/needs a name/);
  });

  it.each(['book club', '2books', 'book-club', 'café'])(
    'refuses %j, which the index could not make a view of',
    (name) => {
      expect(typeNameProblem({ name, existing })).toMatch(/letters, digits and _/);
    },
  );

  it.each(['view', 'Dashboard', 'source', 'atlas', 'type'])(
    'refuses %j, which Atlas already means something by',
    (name) => {
      expect(typeNameProblem({ name, existing })).toMatch(/Atlas uses itself/);
    },
  );

  it('refuses a name another type has, whatever its case', () => {
    expect(typeNameProblem({ name: 'Task', existing })).toMatch(/already a type called "Task"/);
  });
});

describe('propertyKeyProblem', () => {
  it('accepts a key no other property has', () => {
    expect(propertyKeyProblem({ key: 'author', existing: ['title_2'] })).toBeNull();
  });

  it.each(['type', 'path', 'title', 'summary', 'modified'])(
    'refuses %j, which every type view already has',
    (key) => {
      expect(propertyKeyProblem({ key, existing: [] })).toMatch(/every note already has/);
    },
  );

  it('refuses a key that is not an identifier, and one already taken', () => {
    expect(propertyKeyProblem({ key: 'due date', existing: [] })).toMatch(/letters, digits/);
    expect(propertyKeyProblem({ key: 'Due', existing: ['due'] })).toMatch(/already a property/);
    expect(propertyKeyProblem({ key: '', existing: [] })).toMatch(/needs a name/);
  });
});

describe('freePropertyKey', () => {
  it('uses the words when they are free', () => {
    expect(freePropertyKey({ words: 'Due date', existing: ['status'] })).toBe('due_date');
  });

  it('counts up past the keys already taken', () => {
    expect(freePropertyKey({ words: 'Status', existing: ['status', 'status_2'] })).toBe('status_3');
  });

  it('never lands on a reserved key, and names nameless words "property"', () => {
    expect(freePropertyKey({ words: 'Title', existing: [] })).toBe('title_2');
    expect(freePropertyKey({ words: '!!', existing: [] })).toBe('property');
  });
});

describe('isViewColumn', () => {
  it('names the columns every view has, in any case, and nothing else', () => {
    expect(['path', 'title', 'summary', 'modified', 'Modified'].every(isViewColumn)).toBe(true);
    expect(['type', 'due', 'modified_at'].some(isViewColumn)).toBe(false);
  });
});
