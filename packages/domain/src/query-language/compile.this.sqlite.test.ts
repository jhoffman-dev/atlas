import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { indexablePropertiesOf } from '../index/property-value.ts';
import { relationsOf } from '../index/relation-rows.ts';
import { resolveWikiLinkTarget } from '../markdown/resolve-wikilink.ts';
import { parseObjectType } from '../types/property-def.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { compileAtlasQuery } from './compile.ts';
import { parseAtlasQuery } from './parse.ts';

/**
 * `this` — the note a query is shown on — run for real against SQLite over
 * the index's tables: through a relation, one hop through one, and through
 * the links in a note's body. Meetings are dated from the day SQLite says it
 * is, so "the last 30 days" has known edges whatever day the tests run on.
 */
const TYPES = [
  parseObjectType({ name: 'person', properties: { role: 'text' } }),
  parseObjectType({
    name: 'company',
    properties: { owner: { kind: 'relation', target: 'person' } },
  }),
  parseObjectType({
    name: 'meeting',
    properties: {
      people: { kind: 'relation', target: 'person', many: true },
      company: { kind: 'relation', target: 'company' },
      date: 'date',
    },
  }),
];

const MARA = 'people/Mara Quill.md';
const TOBIAS = 'people/Tobias Fenn.md';

const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                      modified INTEGER NOT NULL, size INTEGER NOT NULL);
  CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                      value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);
  CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                          target TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', dst TEXT);
  CREATE TABLE links (src TEXT NOT NULL, dst TEXT, target TEXT NOT NULL, kind TEXT NOT NULL);`);

/** The day SQLite's clock says, that many days on (or back). */
function daysFromToday(days: number): string {
  const row = database.prepare("SELECT date('now', 'localtime', ?) AS day").get(`${days} days`);
  return String(row?.['day']);
}

interface Note {
  readonly path: string;
  readonly frontmatter: Readonly<Record<string, unknown>>;
  /** Body links, by the note each resolves to (null: to none). */
  readonly links?: readonly (string | null)[];
}

const NOTES: readonly Note[] = [
  { path: MARA, frontmatter: { type: 'person' }, links: [MARA, TOBIAS] },
  { path: TOBIAS, frontmatter: { type: 'person' } },
  {
    path: 'companies/Larkspur Payroll.md',
    frontmatter: { type: 'company', owner: '[[Mara Quill]]' },
  },
  {
    path: 'meetings/Mara recent.md',
    frontmatter: {
      type: 'meeting',
      people: ['[[Tobias Fenn]]', '[[Mara Quill]]'],
      company: '[[Larkspur Payroll]]',
      date: daysFromToday(-10),
    },
  },
  {
    path: 'meetings/Mara thirty days ago.md',
    frontmatter: { type: 'meeting', people: ['[[Mara Quill]]'], date: daysFromToday(-30) },
  },
  {
    path: 'meetings/Mara old.md',
    frontmatter: { type: 'meeting', people: ['[[Mara Quill]]'], date: daysFromToday(-40) },
  },
  {
    path: 'meetings/Tobias recent.md',
    frontmatter: { type: 'meeting', people: ['[[Tobias Fenn]]'], date: daysFromToday(-5) },
    links: [MARA, null],
  },
  {
    path: 'Archive/meetings/Mara archived.md',
    frontmatter: { type: 'meeting', people: ['[[Mara Quill]]'], date: daysFromToday(-3) },
    links: [MARA],
  },
];

const PATHS = NOTES.map((note) => createVaultPath(note.path));
const resolveLink = (target: string) => resolveWikiLinkTarget(target, PATHS);

for (const note of NOTES) {
  const title = note.path.replace(/^.*\//, '').replace(/\.md$/, '');
  database.prepare('INSERT INTO files VALUES (?, ?, ?, 0, 1)').run(note.path, title, '');
  for (const row of indexablePropertiesOf(note.frontmatter)) {
    database
      .prepare('INSERT INTO props VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(note.path, row.key, row.index, row.text, row.number, row.date, row.json);
  }
  for (const row of relationsOf(note.frontmatter, resolveLink)) {
    database
      .prepare('INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)')
      .run(note.path, row.key, row.index, row.target, row.name, row.path);
  }
  for (const dst of note.links ?? []) {
    database
      .prepare("INSERT INTO links VALUES (?, ?, ?, 'wikilink')")
      .run(note.path, dst, dst ?? 'Nowhere');
  }
}

function compiled(text: string, thisNote: string) {
  return compileAtlasQuery(parseAtlasQuery(text), { types: TYPES, resolveLink, thisNote });
}

function titles(text: string, thisNote: string): unknown[] {
  const { sql, parameters } = compiled(text, thisNote);
  return database
    .prepare(sql)
    .all(...parameters)
    .map((row) => row['title']);
}

describe('compileAtlasQuery, run against SQLite: this', () => {
  it("answers the card's example: only that person's meetings in the last 30 days", () => {
    const text = 'FROM meeting WHERE people = this AND date > @-30d';
    expect(titles(text, MARA)).toEqual(['Mara recent']);
    expect(titles(text, TOBIAS)).toEqual(['Mara recent', 'Tobias recent']);
  });

  it('lists the meetings without that person for !=', () => {
    expect(titles('FROM meeting WHERE people != this', MARA)).toEqual(['Tobias recent']);
  });

  it('reaches this one hop through a relation', () => {
    expect(titles('FROM meeting WHERE company.owner = this', MARA)).toEqual(['Mara recent']);
    expect(titles('FROM meeting WHERE company.owner = this', TOBIAS)).toEqual([]);
  });

  it('binds the note, never writing its path into the statement', () => {
    const { sql, parameters } = compiled('FROM meeting WHERE people = this', MARA);
    expect(sql).not.toContain('Mara');
    expect(parameters).toContain(MARA);
  });
});

describe('compileAtlasQuery, run against SQLite: LINKS TO this', () => {
  it('lists the notes whose body links to the note the query is shown on', () => {
    expect(titles('FROM meeting WHERE LINKS TO this', MARA)).toEqual(['Tobias recent']);
    expect(titles('FROM person WHERE LINKS TO this', TOBIAS)).toEqual(['Mara Quill']);
  });

  it('does not count a note’s link to itself, as its backlinks do not', () => {
    expect(titles('FROM person WHERE LINKS TO this', MARA)).toEqual([]);
  });

  it('negates and joins like any condition, and leaves archived notes out', () => {
    expect(titles('FROM meeting WHERE NOT LINKS TO this', MARA)).toEqual([
      'Mara old',
      'Mara recent',
      'Mara thirty days ago',
    ]);
    expect(titles('FROM meeting WHERE LINKS TO this OR people = this', TOBIAS)).toEqual([
      'Mara recent',
      'Tobias recent',
    ]);
    expect(titles('FROM meeting WHERE LINKS TO this INCLUDE ARCHIVED', MARA)).toEqual([
      'Mara archived',
      'Tobias recent',
    ]);
  });
});
