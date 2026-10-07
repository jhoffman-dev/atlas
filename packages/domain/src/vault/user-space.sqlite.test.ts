import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createVaultPath } from './vault-path.ts';
import { isUserSpaceNote, userSpaceNoteSql } from './vault-visibility.ts';

/**
 * One rule, two forms: `isUserSpaceNote` in TypeScript and `userSpaceNoteSql`
 * for the index. Every path here is asked of both, so the SQL cannot drift
 * from the rule it is derived from.
 */
const PATHS: Readonly<Record<string, boolean>> = {
  'Note.md': true,
  'tasks/A.md': true,
  'My Vault/Notes/My Note.md': true,
  'a.b/c.md': true,
  'notes/node_modules.md': true,
  'notes/x.trash/y.md': true,
  // Atlas's own notes, the parts the sidebar lists elsewhere and the parts it does not.
  '.atlas/templates/Project.md': false,
  '.atlas/views/Tasks.md': false,
  '.atlas/types/task.md': false,
  // Hidden folders and files at any depth.
  '.trash/Hidden.md': false,
  'deep/down/.trash/Hidden.md': false,
  'deep/.obsidian/x.md': false,
  'notes/.hidden.md': false,
  'a/.b/c/d.md': false,
  // Pruned names, however they are spelled on a disk that ignores case.
  'node_modules/pkg/README.md': false,
  'lib/Node_Modules/pkg/README.md': false,
  'NODE_MODULES/x.md': false,
  '.Trash/x.md': false,
  'x/.GIT/y.md': false,
};

describe('isUserSpaceNote and userSpaceNoteSql', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE files (path TEXT PRIMARY KEY)');
  const insert = database.prepare('INSERT INTO files VALUES (?)');
  for (const path of Object.keys(PATHS)) insert.run(path);
  const inSql = new Set(
    (
      database.prepare(`SELECT path FROM files AS f WHERE ${userSpaceNoteSql('f.path')}`).all() as {
        path: string;
      }[]
    ).map((row) => row.path),
  );

  for (const [path, expected] of Object.entries(PATHS)) {
    it(`${expected ? 'keeps' : 'leaves out'} ${path}`, () => {
      expect(isUserSpaceNote(createVaultPath(path))).toBe(expected);
      expect(inSql.has(path)).toBe(expected);
    });
  }
});
