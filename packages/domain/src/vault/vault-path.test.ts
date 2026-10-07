import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  InvalidVaultPathError,
  joinVaultPath,
  parentVaultPath,
  vaultPathDepth,
  vaultPathName,
  vaultPathSegments,
  VAULT_ROOT,
} from './vault-path.ts';

describe('createVaultPath', () => {
  it('accepts a simple relative path', () => {
    expect(createVaultPath('Notes/today.md')).toBe('Notes/today.md');
  });

  it('treats the empty string as the vault root', () => {
    expect(createVaultPath('')).toBe(VAULT_ROOT);
  });

  it('collapses repeated and trailing separators', () => {
    expect(createVaultPath('Notes//today.md')).toBe('Notes/today.md');
    expect(createVaultPath('Notes/')).toBe('Notes');
  });

  it('keeps spaces, unicode and dots inside names', () => {
    expect(createVaultPath('Daily Notes/2026-09-20.draft.md')).toBe(
      'Daily Notes/2026-09-20.draft.md',
    );
    expect(createVaultPath('Reunión/año.md')).toBe('Reunión/año.md');
  });

  it('keeps dotfiles, which are legitimate vault content', () => {
    expect(createVaultPath('.atlas/types/company.md')).toBe('.atlas/types/company.md');
  });

  describe('refuses anything that could leave the vault', () => {
    it.each([
      ['..', 'the root itself'],
      ['../secrets', 'a parent escape'],
      ['Notes/../../secrets', 'an escape hidden mid-path'],
      ['Notes/..', 'a trailing escape'],
    ])('rejects %j (%s)', (raw) => {
      expect(() => createVaultPath(raw)).toThrow(InvalidVaultPathError);
    });

    it.each(['/etc/passwd', '/Users/jhoffman', 'C:/Windows', 'c:/windows'])(
      'rejects absolute path %j',
      (raw) => {
        expect(() => createVaultPath(raw)).toThrow(InvalidVaultPathError);
      },
    );

    it('rejects a "." segment rather than silently dropping it', () => {
      expect(() => createVaultPath('Notes/./today.md')).toThrow(InvalidVaultPathError);
    });

    it('rejects an embedded null byte', () => {
      expect(() => createVaultPath('Notes/today.md\0.png')).toThrow(InvalidVaultPathError);
    });

    it.each(['..\\..\\secrets.md', 'Notes\\today.md', '\\\\server\\share\\note.md'])(
      'rejects backslash-separated path %j',
      (raw) => {
        // Only '/' is split on, so a backslash path would survive as a single
        // odd filename here and be separators again on a platform that has
        // them. The project is not macOS-only by design.
        expect(() => createVaultPath(raw)).toThrow(InvalidVaultPathError);
      },
    );

    it('names the offending path in the error', () => {
      expect(() => createVaultPath('../secrets')).toThrow(/"\.\.\/secrets"/);
    });
  });
});

describe('joinVaultPath', () => {
  it('joins onto the root without a leading separator', () => {
    expect(joinVaultPath(VAULT_ROOT, 'Notes')).toBe('Notes');
  });

  it('joins onto a nested directory', () => {
    expect(joinVaultPath(createVaultPath('Notes'), 'today.md')).toBe('Notes/today.md');
  });

  it('refuses a name that would escape', () => {
    expect(() => joinVaultPath(createVaultPath('Notes'), '..')).toThrow(InvalidVaultPathError);
  });
});

describe('path inspection', () => {
  it('splits into segments', () => {
    expect(vaultPathSegments(createVaultPath('a/b/c.md'))).toEqual(['a', 'b', 'c.md']);
    expect(vaultPathSegments(VAULT_ROOT)).toEqual([]);
  });

  it('reports the final name', () => {
    expect(vaultPathName(createVaultPath('a/b/c.md'))).toBe('c.md');
    expect(vaultPathName(VAULT_ROOT)).toBe('');
  });

  it('reports depth, with the root at zero', () => {
    expect(vaultPathDepth(VAULT_ROOT)).toBe(0);
    expect(vaultPathDepth(createVaultPath('a'))).toBe(1);
    expect(vaultPathDepth(createVaultPath('a/b/c.md'))).toBe(3);
  });

  it('walks up to the parent, stopping at the root', () => {
    expect(parentVaultPath(createVaultPath('a/b/c.md'))).toBe('a/b');
    expect(parentVaultPath(createVaultPath('a'))).toBe(VAULT_ROOT);
    expect(parentVaultPath(VAULT_ROOT)).toBe(VAULT_ROOT);
  });
});
