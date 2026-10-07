import { describe, expect, it } from 'vitest';
import { mayHoldBlockIds } from './block-anchor.ts';
import { blockOutline, locateFragment } from './block-outline.ts';
import type { EditorDocument, EditorNode } from './editor-node.ts';

/*
 * Adversarial pass on the P26-01 id rules: a note saved on Windows, and a
 * note that holds one id on two blocks (a copy pasted in Obsidian or another
 * editor — Atlas's own editor never makes one, but it reads what it is given).
 */

const paragraph = (value: string, anchor?: string): EditorNode => ({
  type: 'paragraph',
  ...(anchor !== undefined && { attrs: { anchor } }),
  content: [{ type: 'text', text: value }],
});

describe('mayHoldBlockIds', () => {
  it('finds an id that ends a line of a note saved with CRLF line endings', () => {
    // The index skips parsing a note this says has no ids, so its blocks table stays empty.
    expect(mayHoldBlockIds('Pack the tent ^f3k9x2\r\n\r\nNext\r\n')).toBe(true);
  });

  it('finds an id that ends a list item of a note saved with CRLF line endings', () => {
    expect(mayHoldBlockIds('- Pack the tent ^a81b0c\r\n- Book\r\n')).toBe(true);
  });
});

describe('blockOutline', () => {
  it('offers a block by an id only when that id names it', () => {
    // The `#` picker links an entry's id as it is (`#^dup`), without asking
    // the note (wiki-link-suggestion.ts `pick`): an id that names an earlier
    // block links, and embeds, the wrong one.
    const doc: EditorDocument = {
      type: 'doc',
      content: [paragraph('First', 'dup'), paragraph('Second', 'dup')],
    };
    for (const entry of blockOutline(doc)) {
      if (entry.kind !== 'block' || entry.id === null) continue;
      expect(
        { text: entry.text, at: locateFragment(doc, { kind: 'block', id: entry.id }) },
        `the block "${entry.text}" is offered as ^${entry.id}`,
      ).toEqual({ text: entry.text, at: entry.at });
    }
  });
});
