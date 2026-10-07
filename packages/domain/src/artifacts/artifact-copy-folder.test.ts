import { describe, expect, it } from 'vitest';
import type { VaultEntry } from '../vault/vault-entry.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { flattenVaultTree } from '../vault/vault-tree.ts';
import { isArtifactCopyFolder, savedCopyRefusal } from './artifact-copy-folder.ts';

const entry = (kind: 'file' | 'directory', path: string): VaultEntry =>
  ({ kind, name: path.split('/').at(-1) ?? '', path: createVaultPath(path) }) as VaultEntry;

describe('isArtifactCopyFolder', () => {
  const note = entry('file', 'artifacts/Sales Deck.md');
  const copy = entry('directory', 'artifacts/sales-deck');

  it('is a folder in artifacts/ named for a note beside it', () => {
    expect(isArtifactCopyFolder(copy, [copy, note])).toBe(true);
  });

  it('is not a folder no note beside it is named for', () => {
    const drafts = entry('directory', 'artifacts/drafts');
    expect(isArtifactCopyFolder(drafts, [drafts, note])).toBe(false);
  });

  it('is not a folder outside artifacts/, whatever sits beside it', () => {
    const folderNote = entry('file', 'Work/work.md');
    const folder = entry('directory', 'Work/work');
    expect(isArtifactCopyFolder(folder, [folder, folderNote])).toBe(false);
  });

  it('is never a folder that holds a note, which no copy can', () => {
    const asked: string[] = [];
    const holdsNotes = (folder: string) => {
      asked.push(folder);
      return true;
    };
    expect(isArtifactCopyFolder(copy, [copy, note], holdsNotes)).toBe(false);
    expect(asked).toEqual(['artifacts/sales-deck']);
  });

  it('is shown when a note the vault lists is inside it, though it was never read', () => {
    const shown = flattenVaultTree({
      children: new Map([
        [createVaultPath(''), [entry('directory', 'artifacts')]],
        [createVaultPath('artifacts'), [note, copy]],
      ]),
      expanded: new Set([createVaultPath('artifacts')]),
      notePaths: [createVaultPath('artifacts/sales-deck/Minutes.md')],
    }).map((row) => row.entry.path);
    expect(shown).toContain('artifacts/sales-deck');

    const hidden = flattenVaultTree({
      children: new Map([
        [createVaultPath(''), [entry('directory', 'artifacts')]],
        [createVaultPath('artifacts'), [note, copy]],
      ]),
      expanded: new Set([createVaultPath('artifacts')]),
      notePaths: [createVaultPath('artifacts/Sales Deck.md')],
    }).map((row) => row.entry.path);
    expect(hidden).not.toContain('artifacts/sales-deck');
    expect(hidden).toContain('artifacts/Sales Deck.md');
  });

  it('is never a file, nor matched by a file that is not a note', () => {
    expect(isArtifactCopyFolder(note, [copy, note])).toBe(false);
    const page = entry('file', 'artifacts/sales-deck.html');
    expect(isArtifactCopyFolder(copy, [copy, page])).toBe(false);
  });
});

describe('savedCopyRefusal', () => {
  const notePath = createVaultPath('artifacts/Sales Deck.md');

  it('takes a folder beside the note that holds no notes', () => {
    const folder = createVaultPath('artifacts/sales-deck');
    expect(savedCopyRefusal({ notePath, folder, held: ['index.html'] })).toBeNull();
  });

  it('refuses a folder that is not beside the note', () => {
    const folder = createVaultPath('Tasks');
    expect(savedCopyRefusal({ notePath, folder, held: ['index.html'] })).toMatch(/not beside/);
  });

  it('refuses a folder that holds notes, even beside the note', () => {
    const folder = createVaultPath('artifacts/research');
    expect(
      savedCopyRefusal({ notePath, folder, held: ['index.html', 'notes/Interview.md'] }),
    ).toMatch(/holds notes/);
  });
});
