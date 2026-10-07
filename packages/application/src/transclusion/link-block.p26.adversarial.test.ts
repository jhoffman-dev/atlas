import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  locateFragment,
  type EditorDocument,
  type EditorNode,
} from '@atlas/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import type { MarkdownPort } from '../notes/ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import { anchorBlock, type BlockLinkPanes } from './link-block.ts';

/*
 * Adversarial pass on `anchorBlock` (P26-01, P26-02): the id it hands back is
 * what a `[[Note#^id]]` link to the picked block is written with, so it must
 * name that block and no other; and the note must not be written behind a
 * pane that has unsaved typing in it.
 */

/** Each line a paragraph; ` ^id` at its end is the paragraph's id. */
function docOf(body: string): EditorDocument {
  const content = body
    .split('\n')
    .filter((line) => line !== '')
    .map((line): EditorNode => {
      const found = /^(.*) \^([a-z0-9]+)$/.exec(line);
      return {
        type: 'paragraph',
        ...(found !== null && { attrs: { anchor: found[2] } }),
        content: [{ type: 'text', text: found?.[1] ?? line }],
      };
    });
  return { type: 'doc', content };
}

const markdown: MarkdownPort = {
  ...fakeMarkdown(),
  parseBody: (body) => ({ blocks: [], doc: docOf(body) }),
  serializeBody: ({ doc }) =>
    `${doc.content
      .map((node) => {
        const text = (node.content ?? []).map((child) => child.text ?? '').join('');
        const id = node.attrs?.['anchor'];
        return typeof id === 'string' ? `${text} ^${id}` : text;
      })
      .join('\n')}\n`,
};

const plans = createVaultPath('Plans.md');
const rng = { next: () => 0 };

function vault(files: Record<string, string>, onRead: () => void = () => {}) {
  const written: string[] = [];
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      onRead();
      return { text: files[path] ?? '', modified: 1 };
    },
    writeTextFile: async (args) => {
      written.push(args.contents);
      files[args.path] = args.contents;
      return 2;
    },
  });
  return { fs, written, files };
}

describe('anchorBlock hands back an id that names the block picked', () => {
  it('when an earlier block of the note already carries the same id', async () => {
    // Duplicate ids come from copy and paste, in Atlas or in Obsidian.
    const { fs, files } = vault({ [plans]: 'Pack the tent ^dup\nBook the train ^dup\n' });
    const openNotes: BlockLinkPanes = { state: () => 'closed', reload: () => {} };
    const id = await anchorBlock({
      fs,
      markdown,
      openNotes,
      rng,
      path: plans,
      at: [1],
      text: 'Book the train',
    });
    const doc = docOf(files[plans]!);
    expect(locateFragment(doc, { kind: 'block', id })).toEqual([1]);
  });
});

describe('anchorBlock never writes behind a pane with unsaved typing', () => {
  it('when the pane starts typing while the note is being read', async () => {
    let state: 'clean' | 'dirty' = 'clean';
    const { fs, written } = vault({ [plans]: 'Pack the tent\n' }, () => {
      state = 'dirty';
    });
    const openNotes: BlockLinkPanes = { state: () => state, reload: () => {} };
    await expect(
      anchorBlock({ fs, markdown, openNotes, rng, path: plans, at: [0], text: 'Pack the tent' }),
    ).rejects.toBeInstanceOf(UnsavedTypingError);
    expect(written).toEqual([]);
  });
});
