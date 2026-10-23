/**
 * #507 (integration): the Library and All highlights read back from the index
 * what the real markdown reader told it of literature notes — written by the
 * domain's own writers, read by `toIndexedNote`, kept in SQLite in the host's
 * table shapes, and asked with the views' own statements.
 */
import { describe, expect, it } from 'vitest';
import { appendHighlights, createVaultPath, literatureNoteText } from '@dfai/domain';
import { loadAllHighlights, loadLibrary, toIndexedNote } from '@dfai/application';
import { sqliteIndexPort } from '@dfai/application/testing/sqlite';
import { remarkMarkdown } from './markdown-port.ts';
import { noteBlocks } from './note-blocks.ts';

function steps(): () => number {
  let at = 0;
  return () => ((at++ * 11) % 36) / 36;
}

const ART = 'Library/The Art of War.md';
const KINDLE = 'Library/Meditations.md';
const PROJECT = 'Projects/Reading list.md';

const art = appendHighlights({
  text: literatureNoteText({
    kind: 'pdf',
    title: 'The Art of War',
    author: 'Sun Tzu',
    file: createVaultPath('Library/The Art of War.pdf'),
  }).replace(
    /\n---\n$/,
    `\ncover: '![[covers/art.jpg]]'\nproject: '[[Reading list]]'\ntags: [strategy]\n---\n`,
  ),
  highlights: [
    {
      quote: 'All warfare is based on deception.',
      comment: 'Compare the Larkspur pitch.',
      style: { mark: 'highlight', color: 'green' },
      anchor: {
        kind: 'pdf',
        page: 3,
        quote: { exact: 'All warfare is based on deception.', prefix: '', suffix: '' },
        rects: [],
      },
    },
  ],
  random: steps(),
  noteBlocks,
});

const meditations = appendHighlights({
  text: literatureNoteText({ kind: 'kindle', title: 'Meditations', author: null, file: null }),
  highlights: [
    {
      quote: 'Accept the things to which fate binds you.',
      style: { mark: 'underline', color: 'blue' },
      anchor: { kind: 'kindle', location: { start: 77, end: 79 }, annotationId: null },
    },
  ],
  random: steps(),
  noteBlocks,
});

const FILES: readonly [string, string, number][] = [
  [ART, art.text, 2_000],
  [KINDLE, meditations.text, 1_000],
  [PROJECT, '---\ntype: project\n---\n\nThe books to read.\n', 500],
  // The same quote pasted into a plain note is a quote, not a highlight, and no source.
  ['Notes/Pasted.md', art.text.replace('type: literature', 'type: notes'), 3_000],
];

async function indexOfVault() {
  const notePaths = FILES.map(([path]) => createVaultPath(path));
  const index = sqliteIndexPort();
  await index.put(
    FILES.map(([path, text, modified]) =>
      toIndexedNote({
        file: { path, text, modified, size: text.length },
        notePaths,
        markdown: remarkMarkdown,
      }),
    ),
  );
  return index;
}

describe('the research views over the index (#507)', () => {
  it('lists each literature note with its frontmatter, highlight count, tags and project', async () => {
    const library = await loadLibrary({ index: await indexOfVault() });
    expect(library).toEqual([
      {
        path: KINDLE,
        title: 'Meditations',
        author: null,
        kind: 'kindle',
        highlights: 1,
        modified: 1_000,
        tags: [],
        projects: [],
        cover: null,
      },
      {
        path: ART,
        title: 'The Art of War',
        author: 'Sun Tzu',
        kind: 'pdf',
        highlights: 1,
        modified: 2_000,
        tags: ['strategy'],
        projects: [{ path: PROJECT, name: 'Reading list' }],
        cover: 'covers/art.jpg',
      },
    ]);
  });

  it("lists every highlight with its words, comment, style and place, the marker's JSON read for it", async () => {
    const highlights = await loadAllHighlights({ index: await indexOfVault() });
    expect(highlights).toEqual([
      {
        path: ART,
        source: 'The Art of War',
        modified: 2_000,
        index: 0,
        id: art.highlights[0]?.id,
        kind: 'pdf',
        quote: 'All warfare is based on deception.',
        comment: 'Compare the Larkspur pitch.',
        mark: 'highlight',
        color: 'green',
        page: 3,
        location: null,
        tags: ['strategy'],
      },
      {
        path: KINDLE,
        source: 'Meditations',
        modified: 1_000,
        index: 0,
        id: meditations.highlights[0]?.id,
        kind: 'kindle',
        quote: 'Accept the things to which fate binds you.',
        comment: '',
        mark: 'underline',
        color: 'blue',
        page: null,
        location: 77,
        tags: [],
      },
    ]);
  });
});
