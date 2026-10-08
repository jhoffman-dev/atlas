import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  compileVocabularyQuery,
  VOCABULARY_PAGE_SIZE,
  vocabularySourcesOf,
  type VocabularyRow,
} from './vocabulary-query.ts';

/** The index's `files` and `props`, as `apps/desktop/src-tauri/src/index.rs` creates them. */
function index() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE files (path TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
                        modified INTEGER NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE props (path TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL DEFAULT 0,
                        value_text TEXT, value_num REAL, value_date TEXT, value_json TEXT);`);
  const file = database.prepare(
    'INSERT INTO files (path, title, modified, size) VALUES (?, ?, 1, 1)',
  );
  const prop = database.prepare(
    'INSERT INTO props (path, key, idx, value_text) VALUES (?, ?, ?, ?)',
  );
  /** A note and its properties, a list written one row per item as the index writes it. */
  const note = (path: string, title: string, properties: Record<string, string | string[]>) => {
    file.run(path, title);
    for (const [key, value] of Object.entries(properties)) {
      (Array.isArray(value) ? value : [value]).forEach((item, at) => prop.run(path, key, at, item));
    }
  };
  const run = (page = 0) => {
    const { sql, parameters } = compileVocabularyQuery(page);
    return database.prepare(sql).all(...parameters) as unknown as VocabularyRow[];
  };
  return { note, run };
}

describe('the vocabulary’s notes, read from the index’s tables', () => {
  it('are every term, person and company, with the items of their spelling lists in order', () => {
    const { note, run } = index();
    note('Terms/Larkspur.md', 'Larkspur', {
      type: 'term',
      kind: 'company',
      variants: ['lark spur', 'Larks Burr'],
      status: 'draft',
    });
    note('People/Mara Quill.md', 'Mara Quill', { type: 'person', aliases: ['Mara Quil'] });
    note('People/Tobias Fenn.md', 'Tobias Fenn', { type: 'person', role: 'Lead' });
    note('Companies/Larkspur Payroll.md', 'Larkspur Payroll', { type: 'company', aliases: 'LP' });
    note('Tasks/Call.md', 'Call', { type: 'task', aliases: ['ignored'] });

    expect(run()).toEqual([
      {
        path: 'Companies/Larkspur Payroll.md',
        title: 'Larkspur Payroll',
        type: 'company',
        key: 'aliases',
        value: 'LP',
      },
      {
        path: 'People/Mara Quill.md',
        title: 'Mara Quill',
        type: 'person',
        key: 'aliases',
        value: 'Mara Quil',
      },
      {
        path: 'People/Tobias Fenn.md',
        title: 'Tobias Fenn',
        type: 'person',
        key: null,
        value: null,
      },
      { path: 'Terms/Larkspur.md', title: 'Larkspur', type: 'term', key: 'kind', value: 'company' },
      {
        path: 'Terms/Larkspur.md',
        title: 'Larkspur',
        type: 'term',
        key: 'variants',
        value: 'lark spur',
      },
      {
        path: 'Terms/Larkspur.md',
        title: 'Larkspur',
        type: 'term',
        key: 'variants',
        value: 'Larks Burr',
      },
    ]);
  });

  it('leave out templates, hidden folders and the Archive, where a retired term goes', () => {
    const { note, run } = index();
    note('.atlas/templates/Term.md', 'Term', { type: 'term' });
    note('.trash/Old.md', 'Old', { type: 'term' });
    note('Archive/Terms/Retired.md', 'Retired', { type: 'term' });
    note('archive/Gone.md', 'Gone', { type: 'person' });
    note('Terms/Kept.md', 'Kept', { type: 'term' });
    expect(run().map((row) => row.path)).toEqual(['Terms/Kept.md']);
  });

  it('read a note’s type from the first item when it lists several', () => {
    const { note, run } = index();
    note('Both.md', 'Both', { type: ['project', 'term'] });
    note('Term first.md', 'Term first', { type: ['term', 'project'] });
    expect(run().map((row) => row.path)).toEqual(['Term first.md']);
  });

  it('page through the rows', () => {
    expect(compileVocabularyQuery(2).parameters.slice(-2)).toEqual([
      VOCABULARY_PAGE_SIZE,
      2 * VOCABULARY_PAGE_SIZE,
    ]);
  });
});

describe('the notes the rows describe', () => {
  const row = (
    path: string,
    title: string,
    type: string,
    key: string | null = null,
    value: string | null = null,
  ): VocabularyRow => ({ path, title, type, key, value });

  it('are terms with their variants and kind, and people and companies with their aliases', () => {
    const sources = vocabularySourcesOf([
      row('Companies/Larkspur Payroll.md', 'Larkspur Payroll', 'company', 'aliases', 'LP'),
      row('People/Mara Quill.md', 'Mara Quill', 'person', 'aliases', 'Mara Quil'),
      row('People/Mara Quill.md', 'Mara Quill', 'person', 'aliases', 'Mara'),
      row('People/Tobias Fenn.md', 'Tobias Fenn', 'person'),
      row('Terms/Larkspur.md', 'Larkspur', 'term', 'kind', 'company'),
      row('Terms/Larkspur.md', 'Larkspur', 'term', 'variants', 'lark spur'),
    ]);
    expect(sources).toEqual({
      terms: [
        {
          path: 'Terms/Larkspur.md',
          canonical: 'Larkspur',
          variants: ['lark spur'],
          kind: 'company',
        },
      ],
      people: [
        { path: 'People/Mara Quill.md', name: 'Mara Quill', aliases: ['Mara Quil', 'Mara'] },
        { path: 'People/Tobias Fenn.md', name: 'Tobias Fenn', aliases: [] },
      ],
      companies: [
        { path: 'Companies/Larkspur Payroll.md', name: 'Larkspur Payroll', aliases: ['LP'] },
      ],
    });
  });

  it('read only a term’s variants and a name’s aliases as other spellings', () => {
    const sources = vocabularySourcesOf([
      row('Mara.md', 'Mara Quill', 'person', 'variants', 'not an alias'),
      row('Term.md', 'Larkspur', 'term', 'aliases', 'not a variant'),
      row('Term.md', 'Larkspur', 'term', 'kind', 'vendor'),
    ]);
    expect(sources.people[0]?.aliases).toEqual([]);
    expect(sources.terms[0]).toMatchObject({ variants: [], kind: null });
  });

  it('list terms by their right spelling, whatever its case, then by path', () => {
    const sources = vocabularySourcesOf([
      row('a.md', 'zed', 'term'),
      row('b.md', 'Alfa', 'term'),
      row('d.md', 'beta', 'term'),
      row('c.md', 'Beta', 'term'),
    ]);
    expect(sources.terms.map((term) => term.path)).toEqual(['b.md', 'c.md', 'd.md', 'a.md']);
  });
});
