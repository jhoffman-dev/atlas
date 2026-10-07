import { describe, expect, it } from 'vitest';
import { holdsTypeValues, migrationChanges, valuesThatWontFit } from './note-migration.ts';
import { parseObjectType } from './property-def.ts';

describe('migrationChanges', () => {
  describe('a renamed key', () => {
    const rename = { kind: 'renameKey', from: 'due', to: 'deadline' } as const;

    it('moves the value onto the new key and takes the old one out', () => {
      expect(migrationChanges(rename, { due: '2026-10-01', status: 'next' })).toEqual({
        due: null,
        deadline: '2026-10-01',
      });
    });

    it('moves a value that is falsy but present', () => {
      expect(migrationChanges(rename, { due: false })).toEqual({ due: null, deadline: false });
    });

    it('leaves a note without the key, or one that already has the new key, alone', () => {
      expect(migrationChanges(rename, { status: 'next' })).toBeNull();
      expect(migrationChanges(rename, { due: 'a', deadline: 'b' })).toBeNull();
    });
  });

  describe('a removed key', () => {
    it('takes the key out only where it is', () => {
      const remove = { kind: 'removeKey', key: 'owner' } as const;
      expect(migrationChanges(remove, { owner: '[[Ada]]' })).toEqual({ owner: null });
      expect(migrationChanges(remove, { status: 'x' })).toBeNull();
    });
  });

  describe('a renamed option', () => {
    const rename = {
      kind: 'renameOption',
      key: 'status',
      from: 'review',
      to: 'in review',
    } as const;

    it('renames a select holding it', () => {
      expect(migrationChanges(rename, { status: 'review' })).toEqual({ status: 'in review' });
    });

    it('leaves a note holding another option, or none, alone', () => {
      expect(migrationChanges(rename, { status: 'reviewed' })).toBeNull();
      expect(migrationChanges(rename, { status: null })).toBeNull();
      expect(migrationChanges(rename, {})).toBeNull();
    });

    it('renames it inside a list, where it stands, without making a repeat', () => {
      const tags = { kind: 'renameOption', key: 'tags', from: 'a', to: 'b' } as const;
      expect(migrationChanges(tags, { tags: ['x', 'a', 'y'] })).toEqual({ tags: ['x', 'b', 'y'] });
      expect(migrationChanges(tags, { tags: ['a', 'b'] })).toEqual({ tags: ['b'] });
      expect(migrationChanges(tags, { tags: ['x'] })).toBeNull();
    });
  });
});

describe('holdsTypeValues', () => {
  it('is true of an ordinary note of the type', () => {
    expect(holdsTypeValues({ type: 'task', status: 'next' })).toBe(true);
  });

  it.each([
    { atlas: 'view', type: 'task' },
    { atlas: 'dashboard' },
    { atlas: 'source', type: 'event', url: 'https://example.com/feed.ics' },
  ])('is false of a view, a dashboard or a source (%j)', (frontmatter) => {
    expect(holdsTypeValues(frontmatter)).toBe(false);
  });
});

describe('valuesThatWontFit', () => {
  const [phase] = parseObjectType({ name: 't', properties: { phase: 'number' } }).properties;

  it('counts the values the new kind refuses, not the missing ones', () => {
    if (phase === undefined) throw new Error('fixture');
    expect(
      valuesThatWontFit({ def: { ...phase, required: true }, values: ['3', 4, 'soon', null, ''] }),
    ).toBe(1);
  });

  it('counts values that are not among a select’s options', () => {
    const [stage] = parseObjectType({
      name: 't',
      properties: { stage: { kind: 'select', options: ['seed', 'a'] } },
    }).properties;
    if (stage === undefined) throw new Error('fixture');
    expect(valuesThatWontFit({ def: stage, values: ['seed', 'b', 'c'] })).toBe(2);
  });
});
