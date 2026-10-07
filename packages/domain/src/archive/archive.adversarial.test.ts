/**
 * Adversarial pass on Phase 23 (A23): the Archive's pure rules, pushed at the
 * edges the happy-path tests do not reach — spellings the disk treats as one,
 * a way into the Archive that skips archiving, and a link the `[[` menu writes.
 */
import { describe, expect, it } from 'vitest';
import { activeNotePaths, freeNotePath, isArchivedPath } from './archive.ts';
import { rankNoteSuggestions } from '../markdown/note-suggestions.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import { moveRefusal } from '../vault/vault-moves.ts';
import { createVaultPath } from '../vault/vault-path.ts';

const path = createVaultPath;

describe('freeNotePath treats names the disk treats as one as taken (A23)', () => {
  it('numbers a composed name when its decomposed spelling is already there', () => {
    const composed = path('Notes/Café.md');
    const decomposed = 'Notes/Café.md';
    expect(freeNotePath(composed, new Set([decomposed]))).toBe('Notes/Café 2.md');
  });
});

describe('only archiving puts notes in the Archive (A23)', () => {
  it('refuses to move a folder named Archive to the root, where it would become the Archive', () => {
    const folder = { path: path('Notes/Archive'), kind: 'directory' as const };
    expect(isArchivedPath('Archive/plan.md')).toBe(true);
    expect(moveRefusal(folder, path(''))).not.toBeNull();
  });
});

describe('a note picked from the [[ menu is the note the link opens (A23)', () => {
  it('links a live note, not an archived note of the same name that sorts first', () => {
    const vault = [path('Archive/Meeting.md'), path('Notes/Meeting.md')];
    const [picked] = rankNoteSuggestions('Meeting', activeNotePaths(vault), { linkable: vault });
    expect(picked?.path).toBe('Notes/Meeting.md');
    expect(resolveWikiLinkTarget(picked?.target ?? '', vault)).toBe('Notes/Meeting.md');
  });
});
