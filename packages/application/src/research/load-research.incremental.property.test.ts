import { describe, expect, it } from 'vitest';
import { createVaultPath, type NoteChange } from '@dfai/domain';
import type { IndexedHighlightRow, IndexedNote, IndexPort } from '../index/ports.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { changesTouching, HIGHLIGHTS_SCOPE, LIBRARY_SCOPE } from '../reads/scoped-reads.ts';
import { libraryScope } from './library-scope.ts';
import {
  readHighlights,
  readLibrary,
  refreshHighlights,
  refreshLibrary,
  type HighlightsRead,
  type LibraryRead,
} from './load-research.ts';

/*
 * Regression, found verifying PR #525 (P3): whatever the sequence of saves, removals,
 * type changes and archive moves, the list a refresh in place keeps must equal
 * a whole read of the index afterwards. Seeded, so every run is the same.
 */

/** mulberry32: a small seeded generator, so a failing sequence is the same on every run. */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const PATHS = [
  'Library/A.md',
  'Library/b.md',
  'Library/B.md',
  'Library/Émile.md',
  'Library/Zoë.md',
  'Archive/Library/A.md',
  'Notes/Plain.md',
];

/** Types as a note's frontmatter may declare them, and what the change then says. */
const TYPES: readonly { change: string | null; values: readonly string[] }[] = [
  { change: 'literature', values: ['literature'] },
  { change: 'Literature', values: [' Literature '] },
  { change: 'literature,book', values: ['literature', 'book'] },
  { change: 'note', values: ['note'] },
  { change: null, values: [] },
];

const COLORS = ['yellow', 'red', 'green', 'Blue', ''];

interface Written {
  readonly type: string | null;
}

function noteOf(path: string, random: () => number): { note: IndexedNote; type: string | null } {
  const typed = TYPES[Math.floor(random() * TYPES.length)] ?? TYPES[0]!;
  const count = Math.floor(random() * 4);
  const highlights: IndexedHighlightRow[] = Array.from({ length: count }, (_, at) => ({
    id: `${path}#${at}-${Math.floor(random() * 1000)}`,
    kind: 'pdf',
    quote: `Quote ${at}`,
    comment: random() < 0.5 ? '' : 'a thought',
    mark: 'highlight',
    color: COLORS[Math.floor(random() * COLORS.length)] ?? '',
    anchor: `{"v":1,"kind":"pdf","page":${at + 1}}`,
  }));
  const tagCount = Math.floor(random() * 3);
  const note: IndexedNote = {
    path,
    title: `${path.replace(/^.*\//, '').replace(/\.md$/, '')} ${Math.floor(random() * 3)}`,
    // Few distinct times, so sources often tie on when they changed.
    modified: Math.floor(random() * 3),
    size: 0,
    digest: String(random()),
    type: typed.change,
    body: '',
    summary: '',
    properties: typed.values.map((text, index) => ({
      key: 'type',
      index,
      text,
      number: null,
      date: null,
      json: null,
    })),
    links: [],
    tags: Array.from({ length: tagCount }, (_, at) => ({
      key: `topic/${at}`,
      name: `topic/${at}`,
    })),
    relations: [],
    blocks: [],
    checks: [],
    progress: null,
    highlights,
  };
  return { note, type: typed.change };
}

/** One step: a save of a note (new or changed), or its removal, and the change a sync reports for it. */
async function step(
  sqlite: IndexPort,
  written: Map<string, Written>,
  random: () => number,
): Promise<NoteChange> {
  const path = PATHS[Math.floor(random() * PATHS.length)] ?? PATHS[0]!;
  const before = written.get(path);
  if (before !== undefined && random() < 0.25) {
    await sqlite.remove([createVaultPath(path)]);
    written.delete(path);
    return { kind: 'removed', path, type: before.type, digest: 'gone' };
  }
  const { note, type } = noteOf(path, random);
  await sqlite.put([note]);
  written.set(path, { type });
  if (before === undefined) return { kind: 'added', path, type, digest: note.digest };
  return {
    kind: 'changed',
    path,
    type,
    digest: note.digest,
    before: 'earlier',
    ...(before.type !== type && { beforeType: before.type }),
  };
}

const SEEDS = Array.from({ length: 40 }, (_, at) => at + 1);

describe('a refresh in place, over random sequences of changes (seeded)', () => {
  it.each(SEEDS)('keeps All highlights equal to a whole read (seed %i)', async (seed) => {
    const random = seeded(seed);
    const sqlite = sqliteIndexPort();
    const index: Pick<IndexPort, 'query'> = sqlite;
    const written = new Map<string, Written>();
    for (let at = 0; at < 4; at += 1) await step(sqlite, written, random);
    let kept: HighlightsRead = await readHighlights({ index });
    for (let news = 0; news < 12; news += 1) {
      const changes: NoteChange[] = [];
      const steps = 1 + Math.floor(random() * 3);
      for (let at = 0; at < steps; at += 1) changes.push(await step(sqlite, written, random));
      const touching = changesTouching(HIGHLIGHTS_SCOPE, changes);
      if (touching.length === 0) continue;
      const next = await refreshHighlights({ index, previous: kept, changes: touching });
      kept = next ?? (await readHighlights({ index }));
      const whole = await readHighlights({ index });
      expect(kept.entries).toEqual(whole.entries);
      expect(kept.choices).toEqual(whole.choices);
    }
  });

  it.each(SEEDS)('keeps the Library equal to a whole read (seed %i)', async (seed) => {
    const random = seeded(seed * 7919);
    const sqlite = sqliteIndexPort();
    const index: Pick<IndexPort, 'query'> = sqlite;
    const written = new Map<string, Written>();
    for (let at = 0; at < 4; at += 1) await step(sqlite, written, random);
    let kept: LibraryRead = await readLibrary({ index });
    for (let news = 0; news < 12; news += 1) {
      const changes: NoteChange[] = [];
      const steps = 1 + Math.floor(random() * 3);
      for (let at = 0; at < steps; at += 1) changes.push(await step(sqlite, written, random));
      const touching = changesTouching(LIBRARY_SCOPE, changes);
      if (touching.length === 0) continue;
      const next = await refreshLibrary({ index, previous: kept, changes: touching });
      kept = next ?? (await readLibrary({ index }));
      const whole = await readLibrary({ index });
      expect(kept.entries).toEqual(whole.entries);
      expect(kept.choices).toEqual(whole.choices);
    }
  });
});

describe('a Library row filed under a note of no covered type (PR #525 regression)', () => {
  it('is right again on the news of that note, as libraryScope covers it', async () => {
    const sqlite = sqliteIndexPort();
    const index: Pick<IndexPort, 'query'> = sqlite;
    const literatureNote = (path: string, relations: IndexedNote['relations']): IndexedNote => ({
      path,
      title: path.replace(/^.*\//, '').replace(/\.md$/, ''),
      modified: 1,
      size: 0,
      digest: path,
      type: 'literature',
      body: '',
      summary: '',
      properties: [
        { key: 'type', index: 0, text: 'literature', number: null, date: null, json: null },
      ],
      links: [],
      tags: [],
      relations,
      blocks: [],
      checks: [],
      progress: null,
      highlights: [],
    });
    const garden = (title: string): IndexedNote => ({
      ...literatureNote('Notes/Garden.md', []),
      title,
      type: null,
      properties: [],
    });
    await sqlite.put([
      garden('Garden'),
      literatureNote('Library/Seeds.md', [
        { key: 'project', index: 0, target: 'Garden', name: 'garden', path: 'Notes/Garden.md' },
      ]),
      literatureNote('Library/Soil.md', []),
    ]);
    const previous = await readLibrary({ index });
    // The untyped note is retitled. The Library is filed under it, so its scope (`libraryScope`) hears it.
    await sqlite.put([garden('Kitchen garden')]);
    const touching = changesTouching(libraryScope(previous), [
      { kind: 'changed', path: 'Notes/Garden.md', type: null, digest: 'retitled', before: 'x' },
    ]);
    expect(touching).toHaveLength(1);
    const next = await refreshLibrary({ index, previous, changes: touching });
    expect(next).not.toBeNull();

    expect(next?.entries ?? (await readLibrary({ index })).entries).toEqual(
      (await readLibrary({ index })).entries,
    );
  });
});

describe('the Library refreshed in place, by path (PR #525 regression)', () => {
  it("keeps its entries in the index's path order (UTF-8 bytes), as a whole read lists them", async () => {
    const sqlite = sqliteIndexPort();
    const index: Pick<IndexPort, 'query'> = sqlite;
    const source = (path: string): IndexedNote => ({
      path,
      title: 'Untitled',
      modified: 1,
      size: 0,
      digest: path,
      type: 'literature',
      body: '',
      summary: '',
      properties: [
        { key: 'type', index: 0, text: 'literature', number: null, date: null, json: null },
      ],
      links: [],
      tags: [],
      relations: [],
      blocks: [],
      checks: [],
      progress: null,
      highlights: [],
    });
    // U+FB00 sorts after a surrogate pair in UTF-16 code units, but before it in UTF-8 bytes.
    await sqlite.put([source('Library/\uFB00.md')]);
    const previous = await readLibrary({ index });
    await sqlite.put([source('Library/\u{1F4DA}.md')]);
    const next = await refreshLibrary({
      index,
      previous,
      changes: [{ kind: 'added', path: 'Library/\u{1F4DA}.md', type: 'literature', digest: 'x' }],
    });

    expect(next?.entries.map((entry) => entry.path)).toEqual(
      (await readLibrary({ index })).entries.map((entry) => entry.path),
    );
  });
});
