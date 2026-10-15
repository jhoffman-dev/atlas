import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { relationsOf } from '../index/relation-rows.ts';
import { noteNames, withNoteNames, type NoteNames } from '../types/relation-names.ts';
import { createVaultPath } from '../vault/vault-path.ts';
import { filterChoices, relatedChoices } from './filter-choices.ts';
import { filterValueFrom } from './filter-words.ts';
import { compileViewQuery, type FilterOperator, type ViewQuery } from './view-query.ts';

/**
 * A typed filter value run for real against a stand-in for the index's type
 * view. The index builds a text property's column from `value_text`, as a
 * `MAX(CASE …)` expression — a column with no type affinity, so SQLite never
 * converts between the text in it and a number it is compared with.
 */
function roomIndex(rooms: readonly (readonly [string, string])[]) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE props (path TEXT, key TEXT, value_text TEXT);
    CREATE VIEW v_room AS
      SELECT path AS "path", path AS "title", '' AS "summary",
             MAX(CASE WHEN key = 'code' THEN value_text END) AS "code"
      FROM props GROUP BY path;`);
  const insert = database.prepare('INSERT INTO props VALUES (?, ?, ?)');
  for (const [path, code] of rooms) insert.run(path, 'code', code);
  return (query: ViewQuery) => {
    const { sql, parameters } = compileViewQuery(query, {});
    return database
      .prepare(sql)
      .all(...parameters)
      .map((row) => row['path']);
  };
}

const typed = (value: string): ViewQuery => ({
  type: 'room',
  columns: ['code'],
  filters: [{ key: 'code', operator: 'is', value: filterValueFrom(value) ?? '' }],
  sorts: [],
  limit: 100,
});

describe('filterValueFrom, run against a text property', () => {
  const run = roomIndex([
    ['rooms/Lab.md', '007'],
    ['rooms/Hall.md', '1.10'],
    ['rooms/Attic.md', '101'],
    ['rooms/Den.md', 'B2'],
  ]);

  it('finds a word typed as a word (the stand-in index answers at all)', () => {
    expect(run(typed('B2'))).toEqual(['rooms/Den.md']);
  });

  it('finds a text property that holds only digits', () => {
    expect(run(typed('101'))).toEqual(['rooms/Attic.md']);
  });

  it('finds the note whose text is exactly what was typed, leading zeros and all', () => {
    expect(run(typed('007'))).toEqual(['rooms/Lab.md']);
  });

  it('finds a version-like text without reading it as the number 1.1', () => {
    expect(run(typed('1.10'))).toEqual(['rooms/Hall.md']);
  });
});

/**
 * A task type's view over one text property, as `roomIndex` — and, given the
 * vault's notes, the `relations` table the index fills beside it: each link a
 * property holds, resolved by `relationsOf` as the indexer resolves it. The
 * query is compiled with links resolved as the app resolves them.
 */
function taskIndex(
  column: string,
  rows: readonly (readonly [string, string])[],
  names: NoteNames = noteNames(null),
) {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE props (path TEXT, key TEXT, value_text TEXT);
    CREATE TABLE relations (src TEXT, key TEXT, idx INTEGER, target TEXT, name TEXT, dst TEXT);
    CREATE VIEW v_task AS
      SELECT path AS "path", path AS "title", '' AS "summary",
             MAX(CASE WHEN key = '${column}' THEN value_text END) AS "${column}"
      FROM props GROUP BY path;`);
  const insert = database.prepare('INSERT INTO props VALUES (?, ?, ?)');
  const relation = database.prepare('INSERT INTO relations VALUES (?, ?, ?, ?, ?, ?)');
  const resolveLink = (target: string) => names.opens(`[[${target}]]`);
  for (const [path, value] of rows) {
    insert.run(path, column, value);
    for (const row of relationsOf({ [column]: value }, resolveLink)) {
      relation.run(path, row.key, row.index, row.target, row.name, row.path);
    }
  }
  return (operator: FilterOperator, value: string | number | null) => {
    const query: ViewQuery = {
      type: 'task',
      columns: [column],
      filters: [{ key: column, operator, value: value ?? '' }],
      sorts: [],
      limit: 100,
    };
    const { sql, parameters } = compileViewQuery(query, {}, { resolveLink });
    return database
      .prepare(sql)
      .all(...parameters)
      .map((row) => row['path']);
  };
}

describe('tags: compared however they are cased, as tags are (#212)', () => {
  // The tag index folds case and offers the spelling of the tag's first use,
  // by path (compileTagCountsQuery): "Errand", from a/Buy stamps.md.
  const tags = filterChoices(
    { key: 'tags', kind: 'multiSelect' },
    { tags: ['Errand'], related: {} },
  );
  const run = taskIndex('tags', [
    ['a/Buy stamps.md', 'Errand'],
    ['b/Call the bank.md', 'errand'],
    ['c/Ship it.md', 'deploy'],
  ]);

  it('stores a typed tag as typed and still finds the note that holds exactly that', () => {
    expect(filterValueFrom('errand', 'multiSelect', tags)).toBe('errand');
    expect(run('is', filterValueFrom('errand', 'multiSelect', tags))).toContain(
      'b/Call the bank.md',
    );
  });

  it('keeps every note holding the tag, whichever spelling is picked or typed', () => {
    const both = ['a/Buy stamps.md', 'b/Call the bank.md'];
    expect(run('is', 'Errand')).toEqual(both);
    expect(run('is', 'errand')).toEqual(both);
    expect(run('is', '#errand')).toEqual(both);
  });

  it('is not leaves out every note holding the tag, in any spelling', () => {
    expect(run('isNot', 'Errand')).toEqual(['c/Ship it.md']);
  });
});

describe('relation: a link compares by the note it opens, however it is written (#212)', () => {
  const notes = [
    { path: createVaultPath('projects/Larkspur launch.md'), title: 'Larkspur launch' },
    { path: createVaultPath('projects/Quill audit.md'), title: 'Quill audit' },
  ];
  const names = noteNames(notes);
  const choices = relatedChoices(
    notes.map((note) => names.linkTo(note.path)),
    names,
  );
  // Four tasks the table shows as linked to the same project.
  const rows = [
    ['tasks/Plain.md', '[[Larkspur launch]]'],
    ['tasks/Pathed.md', '[[projects/Larkspur launch]]'],
    ['tasks/Lowercase.md', '[[larkspur launch]]'],
    ['tasks/Aliased.md', '[[Larkspur launch|Launch]]'],
  ] as const;
  const run = taskIndex('project', [...rows, ['tasks/Other.md', '[[Quill audit]]']], names);
  const picked = choices.find((choice) => choice.label === 'Larkspur launch')!;

  it('(precondition) every one of those links opens Larkspur launch', () => {
    for (const [, link] of rows) {
      expect(names.opens(link)).toBe('projects/Larkspur launch.md');
    }
    expect(withNoteNames('[[projects/Larkspur launch]]', names)).toBe('Larkspur launch');
  });

  it('contains, typed as the title, keeps matching what it matched before #219', () => {
    // Before #219 the text stayed "Larkspur launch" and all four matched.
    const before = run('contains', 'Larkspur launch');
    expect(before).toHaveLength(4);
    const now = run(
      'contains',
      filterValueFrom('Larkspur launch', 'relation', choices, 'contains'),
    );
    expect(now).toEqual(before);
  });

  it('is, picked as the note, keeps every task the table shows linked to it', () => {
    expect(run('is', picked.value)).toHaveLength(4);
  });

  it('is not, picked as the note, leaves out every task the table shows linked to it', () => {
    expect(run('isNot', picked.value)).toEqual(['tasks/Other.md']);
  });

  it('a link to no note matches the links written as it, in any case', () => {
    const missing = taskIndex(
      'project',
      [
        ['tasks/One.md', '[[Someday plan]]'],
        ['tasks/Two.md', '[[someday plan]]'],
        ['tasks/Three.md', '[[Quill audit]]'],
      ],
      names,
    );
    expect(missing('is', '[[Someday Plan]]')).toEqual(['tasks/One.md', 'tasks/Two.md']);
  });
});
