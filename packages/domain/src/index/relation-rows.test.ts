import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { foldedLinkName } from '../markdown/resolve-wikilink.ts';
import { compileLinkHoldersQuery, linkedName, linkLeaf, relationsOf } from './relation-rows.ts';

describe('compileLinkHoldersQuery, run against SQLite', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                                         target TEXT NOT NULL, name TEXT NOT NULL, dst TEXT);
                 CREATE TABLE links (src TEXT NOT NULL, dst TEXT, target TEXT NOT NULL,
                                     kind TEXT NOT NULL, leaf TEXT NOT NULL)`);
  const relations: [string, string][] = [
    ['a.md', 'Later'],
    ['b.md', 'projects/Later'],
    ['c.md', 'Latest'],
    ['d.md', 'Mylater'],
    ['e.md', 'LATER'],
  ];
  for (const [src, target] of relations) {
    database
      .prepare('INSERT INTO relations VALUES (?, ?, 0, ?, ?, NULL)')
      .run(src, 'project', target, foldedLinkName(target));
  }
  // Body links (#431): held by the last part of the name folded in TypeScript.
  const links: [string, string][] = [
    ['f.md', 'Later'],
    ['g.md', 'clients/\u00c9cole'],
    ['a.md', 'Later'],
  ];
  for (const [src, target] of links) {
    database
      .prepare("INSERT INTO links VALUES (?, NULL, ?, 'wikilink', ?)")
      .run(src, target, linkLeaf(target));
  }
  const holders = (paths: string[]) => {
    const { sql, parameters } = compileLinkHoldersQuery({ made: paths, gone: [] });
    return (database.prepare(sql).all(...parameters) as { path: string }[])
      .map((row) => row.path)
      .sort();
  };

  it('finds every note linking to the name, by name or by path, in any case', () => {
    expect(holders(['p/Later.md'])).toEqual(['a.md', 'b.md', 'e.md', 'f.md']);
  });

  it('finds a body link by path to a name outside ASCII', () => {
    expect(holders(['people/\u00e9cole.md'])).toEqual(['g.md']);
  });

  it('leaves out names that only start or end the same way', () => {
    expect(holders(['Late.md'])).toEqual([]);
  });

  it('asks about several names at once', () => {
    expect(holders(['x/Latest.md', 'Mylater.md'])).toEqual(['c.md', 'd.md']);
  });
});

describe('compileLinkHoldersQuery: which links a note made or gone moves (#440)', () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE relations (src TEXT NOT NULL, key TEXT NOT NULL, idx INTEGER NOT NULL,
                                         target TEXT NOT NULL, name TEXT NOT NULL, dst TEXT);
                 CREATE TABLE links (src TEXT NOT NULL, dst TEXT, target TEXT NOT NULL,
                                     kind TEXT NOT NULL, leaf TEXT NOT NULL)`);
  const link = database.prepare("INSERT INTO links VALUES (?, ?, ?, 'wikilink', ?)");
  link.run('spoke.md', 'Hub.md', 'Hub', linkLeaf('Hub'));
  link.run('elsewhere.md', 'Archive/Hub.md', 'Hub', linkLeaf('Hub'));
  link.run('nowhere.md', null, 'Hub', linkLeaf('Hub'));
  database
    .prepare("INSERT INTO relations VALUES ('task.md', 'project', 0, 'Hub', 'hub', 'Hub.md')")
    .run();
  const holders = (changes: { made?: string[]; gone?: string[] }, offset = 0) => {
    const { sql, parameters } = compileLinkHoldersQuery(
      { made: changes.made ?? [], gone: changes.gone ?? [] },
      offset,
    );
    return (database.prepare(sql).all(...parameters) as { path: string }[]).map((row) => row.path);
  };

  it('leaves out a link already pointing at the note made', () => {
    expect(holders({ made: ['Hub.md'] })).toEqual(['elsewhere.md', 'nowhere.md']);
  });

  it('finds the links pointing at a note gone, and only those', () => {
    expect(holders({ gone: ['Hub.md'] })).toEqual(['spoke.md', 'task.md']);
    expect(holders({ gone: ['Elsewhere.md'] })).toEqual([]);
  });

  it('answers in order from where it is asked to start, as a cut-short answer is asked again', () => {
    expect(holders({ made: ['p/Hub.md'] })).toEqual([
      'elsewhere.md',
      'nowhere.md',
      'spoke.md',
      'task.md',
    ]);
    expect(holders({ made: ['p/Hub.md'] }, 2)).toEqual(['spoke.md', 'task.md']);
  });

  it('asks about nothing when nothing came or went', () => {
    expect(holders({})).toEqual([]);
  });
});

describe('linkLeaf', () => {
  it('is the linked name of every note the link could mean', () => {
    expect(linkLeaf('p/Later.md')).toBe(linkedName('q/Later.md'));
    expect(linkLeaf(' LATER ')).toBe('later');
    expect(linkLeaf('Later/')).toBe('');
  });
});

const where: Readonly<Record<string, string>> = { Julie: 'people/Julie.md', Atlas: 'Atlas.md' };
const resolve = (target: string) => where[target] ?? null;

describe('relationsOf', () => {
  it('gives each property written as a link a row, with the note it resolves to', () => {
    expect(relationsOf({ owner: '[[Julie]]', status: 'done' }, resolve)).toEqual([
      { key: 'owner', index: 0, target: 'Julie', name: 'julie', path: 'people/Julie.md' },
    ]);
  });

  it('keeps a link that points nowhere yet, so a query can still match it by name', () => {
    expect(relationsOf({ owner: '[[Nobody]]' }, resolve)).toEqual([
      { key: 'owner', index: 0, target: 'Nobody', name: 'nobody', path: null },
    ]);
  });

  it('numbers the items of a list the way the properties table numbers them', () => {
    expect(relationsOf({ people: ['[[Julie]]', 'plain', '[[Atlas|the app]]'] }, resolve)).toEqual([
      { key: 'people', index: 0, target: 'Julie', name: 'julie', path: 'people/Julie.md' },
      { key: 'people', index: 2, target: 'Atlas', name: 'atlas', path: 'Atlas.md' },
    ]);
  });

  it('stores the name folded as links fold it: composed, no extension, lower-cased', () => {
    expect(relationsOf({ owner: '[[Cafe\u0301.md]]' }, resolve)[0]?.name).toBe('caf\u00e9');
    expect(relationsOf({ owner: '[[\u00c9cole]]' }, resolve)[0]?.name).toBe('\u00e9cole');
  });

  it('leaves out `type`, which names what a note is rather than a note it points at', () => {
    expect(relationsOf({ type: '[[Atlas]]' }, resolve)).toEqual([]);
  });

  it('reads nothing into a value that is not text', () => {
    expect(relationsOf({ count: 3, nested: { a: '[[Julie]]' }, none: null }, resolve)).toEqual([]);
  });
});
