import { describe, expect, it } from 'vitest';
import { isOutsideVault, recordsFromRows, sqliteFileReference } from './sqlite-file.ts';

describe('recordsFromRows', () => {
  it('makes one record per row, every value as text', () => {
    expect(
      recordsFromRows({
        columns: ['id', 'name', 'score'],
        rows: [
          [1, 'Ada', 9.5],
          [2, 'Grace', 7],
        ],
        truncated: false,
      }),
    ).toEqual([
      { id: '1', name: 'Ada', score: '9.5' },
      { id: '2', name: 'Grace', score: '7' },
    ]);
  });

  it('leaves a NULL out rather than writing it as text', () => {
    expect(
      recordsFromRows({ columns: ['id', 'name'], rows: [[1, null]], truncated: false }),
    ).toEqual([{ id: '1' }]);
  });

  it('keeps the first of two columns with the same name', () => {
    expect(
      recordsFromRows({ columns: ['id', 'id'], rows: [['first', 'second']], truncated: false }),
    ).toEqual([{ id: 'first' }]);
  });
});

describe('sqliteFileReference', () => {
  it('names a file inside the vault relative to it', () => {
    expect(sqliteFileReference({ picked: '/v/data/app.db', vaultRoot: '/v' })).toBe('data/app.db');
    expect(sqliteFileReference({ picked: '/v/app.db', vaultRoot: '/v/' })).toBe('app.db');
  });

  it('keeps a file outside the vault absolute', () => {
    expect(sqliteFileReference({ picked: '/elsewhere/app.db', vaultRoot: '/v' })).toBe(
      '/elsewhere/app.db',
    );
  });

  it('does not mistake a sibling folder sharing a prefix for the vault', () => {
    expect(sqliteFileReference({ picked: '/vault-old/app.db', vaultRoot: '/vault' })).toBe(
      '/vault-old/app.db',
    );
  });
});

describe('isOutsideVault', () => {
  it('tells an absolute path from a vault one', () => {
    expect(isOutsideVault('/Users/me/app.db')).toBe(true);
    expect(isOutsideVault('data/app.db')).toBe(false);
  });
});
