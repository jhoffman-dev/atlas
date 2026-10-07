import { describe, expect, it } from 'vitest';
import { acceptProposal, fakeVaultFs, proposeEdit } from '@atlas/application';
import { remarkMarkdown } from '../markdown/markdown-port.ts';

/**
 * Adversarial (P27-04, ADR-0021): an accepted proposal is written through the
 * real markdown adapter. The card shows `afterBody`; what lands on disk must
 * be that text, with every byte outside the edited spans kept.
 */

function vaultWith(files: Record<string, string>) {
  let modified = 1;
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return { text, modified };
    },
    writeTextFile: async ({ path, contents }) => {
      files[path] = contents;
      modified += 1;
      return modified;
    },
  });
  return { fs, files };
}

const closed = { state: () => 'closed' as const, reload: () => {} };

async function proposeAndAccept(text: string, input: Record<string, unknown>) {
  const { fs, files } = vaultWith({ 'Plan.md': text });
  const made = await proposeEdit({ fs, markdown: remarkMarkdown, input, id: 'p1' });
  await acceptProposal({
    fs,
    openNotes: closed,
    proposal: made,
  });
  return { made, written: files['Plan.md'] ?? '' };
}

describe('accepting a proposal through the real markdown adapter (adversarial)', () => {
  it.each([
    ['a list marker the serializer prefers otherwise', 'Outro.', '* first\n* second'],
    ['an ordered list with a paren', 'Outro.', '1) first\n2) second'],
    ['a setext heading', 'Outro.', 'Heading\n======='],
  ])('writes %s exactly as the card showed it', async (_what, find, replace) => {
    const note = 'Intro.\n\nOutro.\n';
    const { made, written } = await proposeAndAccept(note, {
      path: 'Plan.md',
      edits: [{ find, replace }],
    });
    expect(written).toBe(made.afterBody);
  });

  it.each([['a hard line break of two spaces', 'Line one  \nline two, due soon.']])(
    'a one-word edit keeps the rest of a block with %s as typed',
    async (_what, block) => {
      const note = `Intro.\n\n${block}\n`;
      const { made, written } = await proposeAndAccept(note, {
        path: 'Plan.md',
        edits: [{ find: 'due soon', replace: 'due today' }],
      });
      expect(written).toBe(made.afterBody);
    },
  );

  it('keeps a block embed and block ids byte for byte, beside a property change', async () => {
    const note = '---\ntype: notes\n---\n![[Test Note#^8wdd59]]\n\nKept line. ^keep01\n';
    const section = '## Markdown Test\n\n| a | b |\n| --- | :-: |\n| 1 | 2 |\n\nNew. ^mdtest01';
    const { made, written } = await proposeAndAccept(note, {
      path: 'Plan.md',
      append: section,
      properties: { Notes_project: '[[Test]]' },
    });
    const expected = `---\ntype: notes\nNotes_project: "[[Test]]"\n---\n![[Test Note#^8wdd59]]\n\nKept line. ^keep01\n\n${section}\n`;
    expect(made.contents).toBe(expected);
    expect(written).toBe(expected);
    // The embed and the id'd line are untouched, so the card shows them unchanged.
    expect(made.blocks.map((block) => block.kind)).not.toContain('removed');
  });
});
