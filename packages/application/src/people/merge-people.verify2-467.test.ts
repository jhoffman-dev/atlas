import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@atlas/domain';
import { refreshIndex } from '../index/refresh-index.ts';
import {
  jsonFrontmatterMarkdown as markdown,
  guardedVault as memoryVault,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { previewPeopleMerge, type MergePanes } from './merge-people.ts';

const p = createVaultPath;

const KEPT = 'People/Tobias Fenn.md';
const ROOT_COPY = 'Tobias Fenn.md';
const BOARD = '.atlas/dashboards/Team.md';

const editors: MergePanes = {
  state: () => 'closed',
  flush: async () => {},
  abandon: () => {},
  reload: () => {},
};

describe('a dashboard that names only the kept person by file (verify2-467)', () => {
  it('does not refuse merging a same-titled root copy into its filed copy', async () => {
    // The filed copy's path ends with the root copy's: `people/tobias fenn.md`
    // contains `tobias fenn.md`, but the dashboard names only the person kept.
    const entries = {
      [KEPT]: note({ type: 'person' }, 'Filed copy.\n'),
      [ROOT_COPY]: note({ type: 'person' }, 'Root copy.\n'),
      [BOARD]: `---\nsql: SELECT * FROM notes WHERE owner = '${KEPT}'\n---\n`,
    };
    const vault = memoryVault(entries);
    vault.fs.listDirectory = async (folder) =>
      folder === '.atlas/dashboards' ? [{ kind: 'file', name: 'Team.md', path: p(BOARD) }] : [];
    const index = sqliteIndexPort();
    await refreshIndex({ fs: vault.fs, index, markdown });

    const shown = await previewPeopleMerge({
      ports: { fs: vault.fs, index, markdown, editors },
      request: { keep: p(KEPT), merge: [p(ROOT_COPY)] },
      notePaths: [p(KEPT), p(ROOT_COPY)],
    });

    expect(shown.refusal).toBeNull();
  });
});
