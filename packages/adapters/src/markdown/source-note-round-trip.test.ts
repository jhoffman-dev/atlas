import { describe, expect, it } from 'vitest';
import {
  createVaultPath,
  digestOf,
  parseDatasource,
  planRefresh,
  type Datasource,
  type ExistingSourceNote,
} from '@atlas/domain';
import { openNote, saveNote, fakeVaultFs } from '@atlas/application';
import { remarkMarkdown } from './markdown-port.ts';

/**
 * R12-22 / ADR-0003 ("Untouched blocks keep their original bytes").
 *
 * `planRefresh` (packages/domain/src/sources/merge.ts) decides a note is still
 * Atlas's to replace by comparing `digestOf(body)` against the digest a source
 * wrote into its frontmatter. `body` is whatever the *real* markdown adapter
 * hands back after a read. ADR-0003 promises that reading and writing a block
 * nobody touched reproduces its exact bytes; this test crosses the seam between
 * that promise (packages/adapters) and the rule that leans on it (packages/domain)
 * with the real parser/serializer, not a fake. If serialization ever normalises a
 * body on write — reflows it, re-escapes it, trims a trailing newline — this goes
 * red, because that is exactly the day `planRefresh` would otherwise start
 * silently treating every source-produced note as user-edited, forever, with
 * nothing in the UI saying so.
 *
 * Lives beside the markdown round-trip corpus (not in packages/application)
 * because only the adapters layer is allowed to depend on both the real
 * markdown port (adapters) and the domain rule under test (`digestOf`,
 * `planRefresh`) — application may not import adapters, and domain may not
 * import either.
 */

const sourcePath = 'sources/Feed.md';

function datasource(extra: Record<string, unknown> = {}): Datasource {
  const parsed = parseDatasource({
    atlas: 'source',
    format: 'csv',
    file: 'feed.csv',
    into: 'imported',
    type: 'row',
    key: 'id',
    name: 'name',
    body: 'text',
    ...extra,
  });
  if (parsed === null) throw new Error('the test asked for a source that does not parse');
  return parsed;
}

/** An in-memory vault so the round trip runs through the real fs port shape. */
function vaultWith(files: Record<string, string>) {
  return fakeVaultFs({
    readTextFile: async (path) => {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return { text, modified: 1 };
    },
    writeTextFile: async ({ path, contents }) => {
      files[path] = contents;
      return 2;
    },
  });
}

describe('a source note round-trips through the real markdown adapter', () => {
  // Deliberately touches the things a "nicer" serializer likes to normalise:
  // a trailing newline, a long line, a wiki link, an escaped character, a list
  // and a code block.
  const body = [
    'This paragraph is written as one long line on purpose, long enough that a',
    'formatter tempted to hard-wrap prose at some column would have to touch it,',
    'which is exactly the kind of normalisation ADR-0003 rules out for a block',
    'nobody edited.',
    '',
    'See [[Related Note]] for more, and note the escaped \\* asterisk right here.',
    '',
    '- one',
    '- two',
    '- three',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
  ].join('\n');

  const path = createVaultPath('imported/acme-1.md');
  const digest = digestOf(body);

  function fileTextFor(storedDigest: string): string {
    return (
      '---\n' +
      `atlas_source: ${sourcePath}\n` +
      'atlas_source_key: acme-1\n' +
      `atlas_source_digest: ${storedDigest}\n` +
      'type: row\n' +
      'title: Acme\n' +
      '---\n' +
      body
    );
  }

  it('keeps the body hashing to the digest a source wrote, after open -> save (no edit) -> read', async () => {
    const files: Record<string, string> = { [path]: fileTextFor(digest) };
    const fs = vaultWith(files);

    const note = await openNote({ fs, markdown: remarkMarkdown, path });
    expect(note.originalBody).toBe(body);

    // The save the app makes when a note is opened and closed untouched: the
    // same doc handed straight back, no `changes`.
    const saved = await saveNote({ fs, markdown: remarkMarkdown, note, doc: note.doc });

    // Computed, not a literal: the assertion is the invariant "still hashes to
    // what was stored", not a specific hash.
    expect(digestOf(saved.note.originalBody)).toBe(digest);
    expect(saved.note.originalBody).toBe(body);
  });

  it("is still classified as Atlas's to replace by planRefresh after that round trip", async () => {
    const files: Record<string, string> = { [path]: fileTextFor(digest) };
    const fs = vaultWith(files);

    const note = await openNote({ fs, markdown: remarkMarkdown, path });
    const saved = await saveNote({ fs, markdown: remarkMarkdown, note, doc: note.doc });

    const existing: ExistingSourceNote = {
      path,
      key: 'acme-1',
      digest,
      body: saved.note.originalBody,
    };

    const plan = planRefresh({
      source: datasource(),
      sourcePath,
      records: [{ id: 'acme-1', name: 'Acme', text: 'a fresh fetch of the same record' }],
      existing: [existing],
    });

    expect(plan.writes).toHaveLength(1);
    // A `properties`-only write is what happens once the note is (wrongly)
    // believed to be user-edited. `replace` is the digest still recognising it
    // as the source's, which is the promise this whole test protects.
    expect(plan.writes[0]?.kind).toBe('replace');
  });
});

describe('openNote -> saveNote round trip with no edit, through the real markdown adapter', () => {
  // No existing test exercised this path with the real adapter: open-note.test.ts
  // (packages/application) only ever passes a fake MarkdownPort, so a
  // serializer regression would not show up there.
  const document = [
    '---',
    'title: Today',
    'type: note',
    '---',
    '',
    '# Today',
    '',
    'A paragraph with *emphasis*, a [[wikilink]] and an escaped \\* character.',
    '',
    '- first',
    '- second',
    '',
    '```ts',
    'const x = 1;',
    '```',
    '',
  ].join('\n');

  it('writes the file back byte-identical when the doc is handed back unchanged', async () => {
    const path = createVaultPath('today.md');
    const files: Record<string, string> = { [path]: document };
    const fs = vaultWith(files);

    const note = await openNote({ fs, markdown: remarkMarkdown, path });
    const saved = await saveNote({ fs, markdown: remarkMarkdown, note, doc: note.doc });

    expect(saved.text).toBe(document);
    expect(files[path]).toBe(document);
  });
});
