// @vitest-environment jsdom
/**
 * Attack on PR #534 (#523): a comment typed in place is written by
 * `editHighlightComment`, which replaces the highlight's whole comment with
 * what the field holds. The field was drawn from the note as it was read;
 * when the comment changed on disk since — Kindle sync adding the follow-up
 * note typed on the Kindle, an edit in Obsidian — before the pane read the
 * note again, the write must not throw that newer comment away.
 */
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  appendHighlights,
  createVaultPath,
  literatureNoteText,
  readHighlights,
} from '@dfai/domain';
import { fakeVaultFs, openNote, type OpenNote, type OpenNotes } from '@dfai/application';
import { remarkMarkdown } from '@dfai/adapters';
import { useNoteHighlights } from './use-note-highlights.ts';

const noteBlocks = (text: string) => remarkMarkdown.noteBlocks(text);
const BOOK = createVaultPath('Library/Brightwater.md');

/** A fixed random source: the same ids on every run. */
function drawn(): () => number {
  let at = 0;
  return () => ((at++ * 7 + 3) % 36) / 36;
}

const TEXT = appendHighlights({
  text: literatureNoteText({
    kind: 'kindle',
    title: 'Brightwater',
    author: 'Tobias Fenn',
    asin: 'B0EXAMPLE1',
    file: null,
  }),
  highlights: [
    {
      quote: 'The tide keeps its own hours.',
      anchor: { kind: 'kindle', location: { start: 41, end: 44 }, annotationId: 'A1' },
      comment: 'Lit by Mara.',
    },
  ],
  random: drawn(),
  noteBlocks,
}).text;
const ID = readHighlights(TEXT, noteBlocks)[0]?.id ?? '';

function memoryVault() {
  let clock = 100;
  const files = new Map([[BOOK as string, { text: TEXT, modified: clock }]]);
  const fs = fakeVaultFs({
    readTextFile: async (path) => {
      const file = files.get(path);
      if (file === undefined) throw new Error(`no such file: ${path}`);
      return { ...file };
    },
    writeTextFile: async ({ path, contents, expectedModified }) => {
      if (expectedModified !== null && files.get(path)?.modified !== expectedModified) {
        throw new Error('the note changed on disk since it was opened');
      }
      files.set(path, { text: contents, modified: (clock += 1) });
      return clock;
    },
  });
  const edit = (text: string) => files.set(BOOK, { text, modified: (clock += 1) });
  return { files, fs, edit };
}

const openNotes = {
  state: () => 'clean',
  setPropertiesIfOpen: async () => false,
  reload: () => {},
} as unknown as OpenNotes;

async function commenting() {
  const vault = memoryVault();
  const open: OpenNote = await openNote({ fs: vault.fs, markdown: remarkMarkdown, path: BOOK });
  const hook = renderHook(() =>
    useNoteHighlights({
      fs: vault.fs,
      markdown: remarkMarkdown,
      openNotes,
      flush: async () => {},
      path: BOOK,
      open,
      onChanged: () => {},
    }),
  );
  return { vault, hook };
}

describe('a comment written after the note changed on disk', () => {
  it('starts from a note whose highlight has the comment the field shows (the premise)', () => {
    expect(TEXT).toContain('> Lit by Mara.\n');
    expect(ID).not.toBe('');
  });

  it('keeps the follow-up note a Kindle sync added to the comment since the field was drawn', async () => {
    const { vault, hook } = await commenting();
    // The sync lands while the field is open: the pane has not read the note again yet.
    // As the sync writes a typed note (withHighlightCommentAfter): a paragraph after the comment.
    vault.edit(TEXT.replace('> Lit by Mara.\n', '> Lit by Mara.\n>\n> From the Kindle.\n'));
    await act(async () => {
      // A refusal is an answer too: what is asserted is the file.
      await hook.result.current
        ?.editComment({ id: ID, comment: 'Lit by Mara. Typed in DFAI.' })
        .catch(() => {});
    });
    expect(vault.files.get(BOOK)?.text).toContain('From the Kindle.');
  });

  it('keeps a comment changed in Obsidian since the field was drawn', async () => {
    const { vault, hook } = await commenting();
    vault.edit(TEXT.replace('> Lit by Mara.', '> Lit by Mara, at dusk (Obsidian).'));
    await act(async () => {
      await hook.result.current
        ?.editComment({ id: ID, comment: 'Lit by Mara. Typed in DFAI.' })
        .catch(() => {});
    });
    expect(vault.files.get(BOOK)?.text).toContain('at dusk (Obsidian)');
  });
});
