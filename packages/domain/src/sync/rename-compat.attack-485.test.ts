import { describe, expect, it } from 'vitest';
import { hasManagedIgnores, withManagedIgnores } from './sync-ignore.ts';
import { macOfCommit, syncCommitMessage, syncSetUpMessage } from './sync-rules.ts';

// PR #485 (attack-485): one Mac still on Atlas, one on DFAI, one vault.
// Atlas reads back only exactly what it wrote, so DFAI must write the same bytes.

const ATLAS_ERA_BLOCK = [
  '# >>> Atlas sync (managed: edits between these lines are replaced)',
  '# the index, which rebuilds itself on each Mac',
  '.atlas-cache/',
  "# Finder's folder state",
  '.DS_Store',
  "# Obsidian's per-Mac window state",
  '.obsidian/workspace*.json',
  "# Obsidian's own trash",
  '.trash/',
  '# <<< Atlas sync',
].join('\n');

describe('a vault synced between an Atlas Mac and a DFAI Mac', () => {
  it('DFAI leaves a .gitignore Atlas wrote byte-for-byte as it is', () => {
    const atlasWrote = `node_modules/\n\n${ATLAS_ERA_BLOCK}\n`;

    expect(hasManagedIgnores(atlasWrote)).toBe(true);
    expect(withManagedIgnores(atlasWrote)).toBe(atlasWrote);
  });

  it('DFAI writes a commit subject an Atlas Mac reads the Mac name back out of', () => {
    const subject = syncCommitMessage({ mac: 'Studio', localNow: '2026-10-21T09:05:33' });
    const atlasReads = /^Atlas sync from (.+) \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.exec(subject);

    expect(atlasReads?.[1]).toBe('Studio');
    expect(/^Atlas sync set up on (.+)$/.exec(syncSetUpMessage('Studio'))?.[1]).toBe('Studio');
  });

  it('DFAI reads the Mac name out of both an Atlas and a DFAI subject', () => {
    expect(macOfCommit('Atlas sync from Laptop 2026-09-28 13:00')).toBe('Laptop');
    expect(macOfCommit('DFAI sync from Laptop 2026-09-28 13:00')).toBe('Laptop');
    expect(macOfCommit('Atlas sync set up on Laptop')).toBe('Laptop');
    expect(macOfCommit('DFAI sync set up on Laptop')).toBe('Laptop');
  });
});
