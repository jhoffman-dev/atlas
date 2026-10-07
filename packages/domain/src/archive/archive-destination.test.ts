/**
 * Where unarchiving may put a note (A20-06): back where the Archive holds it,
 * minus `Archive/`. `archivedFrom` is honoured only when it names that same
 * place — so an edited stamp can never move a note elsewhere, rename it, make
 * folders, give it another extension or bury it past the walk's depth.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { VAULT_WALK_DEPTH } from '../vault/vault-visibility.ts';
import { archiveRefusal, originOf, restoreDestination } from './archive.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);
const restored = (archived: string, archivedFrom: unknown) =>
  restoreDestination({ path: path(archived), archivedFrom, taken: new Set() });

describe('restoreDestination honours archivedFrom only for the place the Archive implies', () => {
  it.each([
    ['another folder', 'Elsewhere/X.md'],
    ['another name', 'Projects/Y.md'],
    ['another extension', 'Projects/X.markdown'],
    ['a folder further down', 'Projects/Deep/Deeper/X.md'],
    ['a folder further up', 'X.md'],
    ['a number the Archive’s name does not have', 'Projects/X 2.md'],
  ])('ignores a record naming %s', (_label, archivedFrom) => {
    expect(restored('Archive/Projects/X.md', archivedFrom)).toBe('Projects/X.md');
  });

  it('never buries a note past the depth the vault is read to', () => {
    const deep = Array.from({ length: VAULT_WALK_DEPTH + 5 }, (_, at) => `d${at}`).join('/');
    expect(restored('Archive/X.md', `${deep}/X.md`)).toBe('X.md');
  });

  it('takes the recorded spelling of the same place, in another case or composition', () => {
    expect(restored('Archive/projects/café.md', 'Projects/Café.md')).toBe('Projects/Café.md');
  });

  it('takes the record back past the number archiving gave a clashing name', () => {
    expect(restored('Archive/Projects/X 2.md', 'Projects/X.md')).toBe('Projects/X.md');
  });

  it('does not strip a number from a name that had one of its own', () => {
    expect(restored('Archive/Projects/X 2.md', 'Projects/X 3.md')).toBe('Projects/X 2.md');
  });

  it('keeps the spaces a record holds rather than trimming them', () => {
    expect(originOf(path('Archive/ Drafts/ X.md'), ' Drafts/ X.md')).toBe(' Drafts/ X.md');
  });
});

describe('archiveRefusal past the walk’s depth', () => {
  const nested = (segments: number) =>
    path([...Array.from({ length: segments - 1 }, (_, at) => `d${at}`), 'X.md'].join('/'));

  it('refuses a note the Archive would file deeper than the vault is read', () => {
    // The walk reads notes up to VAULT_WALK_DEPTH folders down; Archive/ adds one.
    expect(archiveRefusal(nested(VAULT_WALK_DEPTH + 1))).not.toBeNull();
  });

  it('allows the deepest note whose archived path the walk still reads', () => {
    expect(archiveRefusal(nested(VAULT_WALK_DEPTH))).toBeNull();
  });
});
