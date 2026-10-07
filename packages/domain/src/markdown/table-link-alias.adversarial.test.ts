import { describe, expect, it } from 'vitest';
import type { VaultPath } from '../vault/vault-path.ts';
import { notesAfterMove, retargetLinks } from './retarget-links.ts';
import { splitWikiLinks } from './wikilink.ts';

/**
 * In a table cell an alias's pipe is written `\|` — Obsidian's convention, and
 * since A21-03 the one Atlas's writer uses and its reader reads. The domain's
 * link grammar, which the index and a rename use, must read it the same way.
 */

const TABLE = '| Project |\n| - |\n| [[Plan\\|the plan]] |\n';

describe('an aliased link in a table cell', () => {
  it('links to its target, not to the target with a trailing backslash', () => {
    const links = splitWikiLinks(TABLE).filter((piece) => piece.kind === 'wikiLink');
    expect(links).toEqual([{ kind: 'wikiLink', target: 'Plan', heading: null, alias: 'the plan' }]);
  });

  it('follows its note when the note is renamed', () => {
    const move = { from: 'Plan.md' as VaultPath, to: 'Roadmap.md' as VaultPath };
    const notes = ['Plan.md', 'Holder.md'] as VaultPath[];
    const { text } = retargetLinks({
      text: TABLE,
      path: 'Holder.md' as VaultPath,
      exists: () => false,
      ...notesAfterMove(move, notes),
    });
    expect(text).toBe('| Project |\n| - |\n| [[Roadmap\\|the plan]] |\n');
  });
});
