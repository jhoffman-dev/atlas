/**
 * Adversarial (P30-01): what a note may be filed under, and where that puts
 * it. A project's folder sits beside its note, so a project at the root named
 * as one of the app's own folders would file into that folder.
 */
import { describe, expect, it } from 'vitest';
import { createVaultPath, type VaultPath } from '../vault/vault-path.ts';
import { filingFolder, filingRefusal } from './inbox.ts';

const path = (raw: string): VaultPath => createVaultPath(raw);

describe('filingRefusal — a project whose folder is the Inbox or the Archive', () => {
  it('refuses a project at Inbox.md, whose folder is the Inbox itself', () => {
    expect(filingRefusal({ path: path('Inbox.md'), type: 'project' })).not.toBeNull();
  });

  it('refuses an area at archive.md, whose folder is the Archive in any case', () => {
    expect(filingRefusal({ path: path('archive.md'), type: 'area' })).not.toBeNull();
  });
});

describe('filingFolder — a project kept as its folder’s own note', () => {
  it('files into that folder when the folder is spelled decomposed and the note composed', () => {
    // The same name: "Café" as macOS may write a folder (NFD) and a note synced from elsewhere (NFC).
    const folder = 'Projects/Café';
    const project = path(`${folder}/Café.md`);
    expect(filingFolder(project)).toBe(folder);
  });
});
