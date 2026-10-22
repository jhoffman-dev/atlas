import { describe, expect, it } from 'vitest';
import { lineNoteBlocks as noteBlocks } from '@dfai/domain/testing';
import {
  createVaultPath,
  HighlightNotFoundError,
  HighlightNotReadBackError,
  UnreadableHighlightMarkerError,
  InvalidHighlightAnchorError,
  readHighlights,
  literatureNoteText,
  type NewHighlight,
  type VaultPath,
} from '@dfai/domain';
import { fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { UnsavedTypingError } from '../vault/update-links.ts';
import {
  addHighlight,
  addHighlights,
  editHighlightComment,
  NotALiteratureNoteError,
  removeHighlight,
} from './literature-note-writes.ts';

const PATH = createVaultPath('Library/The Art of War.md');
const SOURCE = literatureNoteText({
  kind: 'pdf',
  title: 'The Art of War',
  author: 'Sun Tzu',
  file: createVaultPath('Library/The Art of War.pdf'),
});

/** mulberry32, so the ids drawn are the same every run. */
function seededRng(seed: number) {
  let state = seed >>> 0;
  return {
    next: () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** A vault of one note that records each write and the version it was made against. */
function vault(text: string) {
  const file = { text, modified: 10 };
  const writes: { contents: string; expectedModified: number | null; expectedText?: string }[] = [];
  const fs = fakeVaultFs({
    readTextFile: async () => ({ ...file }),
    writeTextFile: async ({ contents, expectedModified, expectedText }) => {
      writes.push({
        contents,
        expectedModified,
        ...(expectedText !== undefined && { expectedText }),
      });
      file.text = contents;
      file.modified += 1;
      return file.modified;
    },
  });
  return { fs, file, writes };
}

/** Panes holding the note: in the states given, one per question asked, then the last forever. */
function panes(...states: ('closed' | 'clean' | 'dirty')[]) {
  const reloaded: VaultPath[] = [];
  let asked = 0;
  return {
    state: () => states[Math.min(asked++, states.length - 1)] ?? 'closed',
    reload: (path: VaultPath) => {
      reloaded.push(path);
    },
    reloaded,
  };
}

const deception: NewHighlight = {
  quote: 'All warfare is based on deception.',
  anchor: {
    kind: 'pdf',
    page: 3,
    quote: { exact: 'All warfare is based on deception.', prefix: '', suffix: '' },
    rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.02 }],
  },
};

const ports = (text: string, openNotes = panes('closed')) => {
  const held = vault(text);
  return {
    ...held,
    openNotes,
    ports: {
      fs: held.fs,
      markdown: { ...fakeMarkdown(), noteBlocks },
      openNotes,
      rng: seededRng(503),
    },
  };
};

describe('adding a highlight', () => {
  it('appends it to the literature note against the version read, and answers its new id', async () => {
    const { ports: given, writes, file } = ports(SOURCE);
    const answered = await addHighlight(given, {
      path: PATH,
      highlight: { ...deception, comment: 'Key.' },
    });
    expect(answered.added).toBe(true);
    expect(answered.id).toMatch(/^[a-z0-9]{6}$/);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ expectedModified: 10, expectedText: SOURCE });
    expect(file.text.startsWith(SOURCE)).toBe(true);
    expect(readHighlights(file.text, noteBlocks)).toMatchObject([
      { id: answered.id, quote: 'All warfare is based on deception.', comment: 'Key.' },
    ]);
  });

  it('draws the same id from the same seed', async () => {
    const first = await addHighlight(ports(SOURCE).ports, { path: PATH, highlight: deception });
    const second = await addHighlight(ports(SOURCE).ports, { path: PATH, highlight: deception });
    expect(first.id).toBe(second.id);
  });

  it('adds many, and writes nothing when every one is there already', async () => {
    const { ports: given, writes, file } = ports(SOURCE);
    const other: NewHighlight = {
      quote: 'Know the enemy.',
      anchor: { kind: 'kindle', location: { start: 40, end: null }, annotationId: 'AMZ-1' },
    };
    const added = await addHighlights(given, { path: PATH, highlights: [deception, other] });
    expect(added.map((highlight) => highlight.added)).toEqual([true, true]);
    const again = await addHighlights(given, { path: PATH, highlights: [other, deception] });
    expect(again).toEqual([
      { id: added[1]?.id, added: false },
      { id: added[0]?.id, added: false },
    ]);
    expect(writes).toHaveLength(1);
    expect(readHighlights(file.text, noteBlocks)).toHaveLength(2);
  });

  it('reloads a pane that holds the note with nothing unsaved', async () => {
    const openNotes = panes('clean');
    const { ports: given } = ports(SOURCE, openNotes);
    await addHighlight(given, { path: PATH, highlight: deception });
    expect(openNotes.reloaded).toEqual([PATH]);
  });

  it('reloads no pane when none holds the note', async () => {
    const openNotes = panes('closed');
    await addHighlight(ports(SOURCE, openNotes).ports, { path: PATH, highlight: deception });
    expect(openNotes.reloaded).toEqual([]);
  });

  it('refuses a note with unsaved typing in a pane, before or after reading it', async () => {
    for (const openNotes of [panes('dirty'), panes('clean', 'dirty')]) {
      const { ports: given, writes } = ports(SOURCE, openNotes);
      await expect(addHighlight(given, { path: PATH, highlight: deception })).rejects.toThrow(
        UnsavedTypingError,
      );
      expect(writes).toEqual([]);
    }
  });

  it('refuses a note that is not a literature note', async () => {
    const { ports: given, writes } = ports('---\ntype: notes\n---\nWords.\n');
    await expect(addHighlight(given, { path: PATH, highlight: deception })).rejects.toThrow(
      NotALiteratureNoteError,
    );
    await expect(
      addHighlight(ports('Words.\n').ports, { path: PATH, highlight: deception }),
    ).rejects.toThrow(/The Art of War is not a literature note/);
    expect(writes).toEqual([]);
  });

  it('refuses a bad anchor and writes nothing', async () => {
    const { ports: given, writes } = ports(SOURCE);
    const bad: NewHighlight = { ...deception, anchor: { ...deception.anchor, page: 0 } as never };
    await expect(addHighlight(given, { path: PATH, highlight: bad })).rejects.toThrow(
      InvalidHighlightAnchorError,
    );
    expect(writes).toEqual([]);
  });

  it("passes on the vault's refusal of a write the file changed under", async () => {
    const { ports: given } = ports(SOURCE);
    const refusing = {
      ...given,
      fs: {
        ...given.fs,
        writeTextFile: async () => {
          throw new Error('The file changed on disk.');
        },
      },
    };
    await expect(addHighlight(refusing, { path: PATH, highlight: deception })).rejects.toThrow(
      'The file changed on disk.',
    );
  });
});

describe("editing a highlight's comment and removing a highlight", () => {
  async function noteWithTwo() {
    const held = ports(SOURCE);
    const [first, second] = await addHighlights(held.ports, {
      path: PATH,
      highlights: [
        { ...deception, comment: 'First.' },
        {
          quote: 'Know the enemy.',
          anchor: { kind: 'kindle', location: { start: 9, end: null }, annotationId: null },
        },
      ],
    });
    held.writes.length = 0;
    return { ...held, first: first?.id as string, second: second?.id as string };
  }

  it('changes only the comment, against the version read', async () => {
    const { ports: given, file, writes, first, second } = await noteWithTwo();
    const before = readHighlights(file.text, noteBlocks).find((block) => block.id === second);
    await editHighlightComment(given, { path: PATH, id: first, comment: 'Changed.' });
    expect(writes[0]).toMatchObject({ expectedModified: 11 });
    const after = readHighlights(file.text, noteBlocks);
    expect(after.find((block) => block.id === first)?.comment).toBe('Changed.');
    expect(after.find((block) => block.id === second)).toMatchObject({
      quote: before?.quote,
      comment: '',
    });
  });

  it('writes nothing when the comment is what it was', async () => {
    const { ports: given, writes, first } = await noteWithTwo();
    await editHighlightComment(given, { path: PATH, id: first, comment: 'First.' });
    expect(writes).toEqual([]);
  });

  it('removes the highlight it is told to and no other', async () => {
    const { ports: given, file, first, second } = await noteWithTwo();
    await removeHighlight(given, { path: PATH, id: first });
    expect(readHighlights(file.text, noteBlocks).map((block) => block.id)).toEqual([second]);
  });

  it('refuses a highlight the note no longer holds, writing nothing', async () => {
    const { ports: given, writes } = await noteWithTwo();
    await expect(
      editHighlightComment(given, { path: PATH, id: 'gone00', comment: 'x' }),
    ).rejects.toThrow(HighlightNotFoundError);
    await expect(removeHighlight(given, { path: PATH, id: 'gone00' })).rejects.toThrow(
      HighlightNotFoundError,
    );
    expect(writes).toEqual([]);
  });

  it('refuses either with unsaved typing in a pane', async () => {
    const held = await noteWithTwo();
    const dirty = { ...held.ports, openNotes: panes('dirty') };
    await expect(
      editHighlightComment(dirty, { path: PATH, id: held.first, comment: 'x' }),
    ).rejects.toThrow(UnsavedTypingError);
    await expect(removeHighlight(dirty, { path: PATH, id: held.first })).rejects.toThrow(
      UnsavedTypingError,
    );
    expect(held.writes).toEqual([]);
  });
});

describe('adding a highlight the note could not hold (review of #510)', () => {
  it('writes nothing when the note ends in an unclosed code fence', async () => {
    const held = ports(`${SOURCE}Notes.\n\n\`\`\`js\nlet draft;\n`);
    // The parser runs an unclosed fence to the end of the note: no quote after it is a block.
    const fenced = (text: string) => {
      const blocks = noteBlocks(text);
      return {
        ...blocks,
        quotes: blocks.quotes.filter((quote) => quote.start < text.indexOf('```')),
      };
    };
    const given = { ...held.ports, markdown: { ...held.ports.markdown, noteBlocks: fenced } };
    await expect(addHighlight(given, { path: PATH, highlight: deception })).rejects.toThrow(
      HighlightNotReadBackError,
    );
    expect(held.writes).toEqual([]);
  });

  it('writes nothing when the note holds a marker this build cannot read', async () => {
    const held = ports(
      `${SOURCE}> Words.\n> <!-- atlas:highlight {"v":2,"kind":"pdf","page":1} -->\n\n^abc123\n`,
    );
    await expect(addHighlight(held.ports, { path: PATH, highlight: deception })).rejects.toThrow(
      UnreadableHighlightMarkerError,
    );
    expect(held.writes).toEqual([]);
  });
});
