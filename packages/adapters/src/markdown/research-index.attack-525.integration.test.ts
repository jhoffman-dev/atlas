/**
 * Attack tests for PR #525 (#507, integration): what the Library and All
 * highlights read back from the index for literature notes written in ways
 * the happy path does not — a `type:` list, a note with no `kind:`, an
 * archived source — through the real markdown reader and the views' own
 * statements.
 */
import { describe, expect, it } from 'vitest';
import { appendHighlights, createVaultPath, literatureNoteText } from '@dfai/domain';
import { loadAllHighlights, loadLibrary, toIndexedNote } from '@dfai/application';
import { sqliteIndexPort } from '@dfai/application/testing/sqlite';
import { remarkMarkdown } from './markdown-port.ts';
import { noteBlocks } from './note-blocks.ts';

function steps(): () => number {
  let at = 0;
  return () => ((at++ * 7) % 36) / 36;
}

function sourceText(title: string, quote: string): string {
  return appendHighlights({
    text: literatureNoteText({ kind: 'epub', title, author: 'Mara Quill', file: null }),
    highlights: [
      {
        quote,
        style: { mark: 'highlight', color: 'yellow' },
        anchor: { kind: 'kindle', location: { start: 10, end: 12 }, annotationId: null },
      },
    ],
    random: steps(),
    noteBlocks,
  }).text;
}

async function indexOf(files: readonly (readonly [string, string, number])[]) {
  const notePaths = files.map(([path]) => createVaultPath(path));
  const index = sqliteIndexPort();
  await index.put(
    files.map(([path, text, modified]) =>
      toIndexedNote({
        file: { path, text, modified, size: text.length },
        notePaths,
        markdown: remarkMarkdown,
      }),
    ),
  );
  return index;
}

describe('the research views over literature notes written oddly (attack #525)', () => {
  it('a note whose `type:` is a list holding literature is a source both views agree on', async () => {
    const listed = sourceText('The Larkspur Ledger', 'Every ledger tells a story.').replace(
      'type: literature',
      'type: [literature, book]',
    );
    const index = await indexOf([['Library/Ledger.md', listed, 1_000]]);
    const library = await loadLibrary({ index });
    const highlights = await loadAllHighlights({ index });
    // Either it is a source with the one highlight it holds, or it is not a
    // source at all: never a Library row that says "0 highlights" of a note
    // holding one, which All highlights and ⌘K then never find.
    const counted = library.map((each) => each.highlights);
    expect(counted.length === 0 ? [] : [counted, highlights.length]).toEqual(
      counted.length === 0 ? [] : [[1], 1],
    );
  });

  it('a literature note with no `kind:` is listed with no kind, and its highlights are listed', async () => {
    const kindless = sourceText('Tobias Fenn Letters', 'Write it down twice.').replace(
      /\nkind: epub\n/,
      '\n',
    );
    const index = await indexOf([['Library/Letters.md', kindless, 1_000]]);
    const library = await loadLibrary({ index });
    expect(library.map((each) => [each.title, each.kind])).toEqual([['Tobias Fenn Letters', null]]);
    const highlights = await loadAllHighlights({ index });
    expect(highlights.map((each) => each.quote)).toEqual(['Write it down twice.']);
  });

  it('an archived source and its highlights are in neither view', async () => {
    const index = await indexOf([
      ['Archive/Old Ledger.md', sourceText('Old Ledger', 'Gone but kept.'), 2_000],
      ['Library/Ledger.md', sourceText('Ledger', 'Still here.'), 1_000],
    ]);
    expect((await loadLibrary({ index })).map((each) => each.title)).toEqual(['Ledger']);
    expect((await loadAllHighlights({ index })).map((each) => each.quote)).toEqual(['Still here.']);
  });
});
