import { describe, expect, it } from 'vitest';
import { createVaultPath } from '@dfai/domain';
import { refreshIndex } from '../index/refresh-index.ts';
import {
  jsonFrontmatterMarkdown as markdown,
  guardedVault,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { applyPeopleMerge, previewPeopleMerge, type MergePorts } from './merge-people.ts';

/*
 * Verification of PR #467's fix round (merge duplicate people, #464): the
 * typing saved before a preview, and DFAI's own files linking to a merged
 * person. Fictional names only.
 */

const p = createVaultPath;
const KEPT = 'People/Mara Quill.md';
const SHORT = 'Mara.md';

async function setUp(entries: Record<string, string>) {
  const vault = guardedVault({
    [KEPT]: note({ type: 'person' }, 'Leads payroll.\n'),
    [SHORT]: note({ type: 'person' }, 'Met at the kickoff.\n'),
    ...entries,
  });
  const index = sqliteIndexPort();
  await refreshIndex({ fs: vault.fs, index, markdown });
  const notePaths = [...vault.files.keys()].filter((path) => path.endsWith('.md')).map(p);
  return { vault, index, notePaths };
}

describe('saving every pane before a merge preview (verify-467)', () => {
  it('refuses while a pane on another note keeps typing its save refused, since it may hold a link to a merged person', async () => {
    const { vault, index, notePaths } = await setUp({ 'Notes.md': 'Nothing yet.\n' });
    // `Notes.md` is open with `Call [[Mara]].` typed; the disk refuses its save
    // (full, or the file is locked), so the pane stays dirty.
    const ports: MergePorts = {
      fs: vault.fs,
      index,
      markdown,
      editors: {
        state: (path) => (path === 'Notes.md' ? 'dirty' : 'closed'),
        dirtyPaths: () => [p('Notes.md')],
        flush: async () => {},
        abandon: () => {},
        reload: () => {},
      },
      refreshIndex: async (saved) => {
        await refreshIndex({ fs: vault.fs, index, markdown, recheck: saved });
      },
    };
    const shown = await previewPeopleMerge({
      ports,
      request: { keep: p(KEPT), merge: [p(SHORT)] },
      notePaths,
    });
    // Observed: the merge is offered; confirmed, Mara goes to the Trash and the
    // pane's `[[Mara]]`, saved later, opens nothing.
    expect(shown.refusal ?? 'no refusal').toContain('Notes.md');
  });
});

describe("DFAI's own files linking to a merged person (verify-467)", () => {
  it('does not leave a saved view filtered by a merged person silently matching nothing', async () => {
    const VIEW = '.atlas/views/Mara’s work.md';
    const { vault, index, notePaths } = await setUp({
      'Kickoff.md': note({ type: 'meeting', owner: '[[Mara]]' }, 'Kickoff.\n'),
      [VIEW]: note(
        {
          atlas: 'view',
          type: 'meeting',
          layout: 'list',
          filters: [{ key: 'owner', operator: 'is', value: '[[Mara]]' }],
        },
        '# Mara’s work\n',
      ),
    });
    const ports: MergePorts = {
      fs: vault.fs,
      index,
      markdown,
      editors: {
        state: () => 'closed',
        flush: async () => {},
        abandon: () => {},
        reload: () => {},
      },
    };
    const preview = await previewPeopleMerge({
      ports,
      request: { keep: p(KEPT), merge: [p(SHORT)] },
      notePaths,
    });
    if (preview.refusal === null) await applyPeopleMerge({ ports, preview });
    // Either the merge is refused, naming the view, or the view's filter now
    // opens the kept person. Observed: the merge goes through, Mara is in the
    // Trash, `Kickoff.md` says `[[Mara Quill]]`, and the view still filters
    // `owner is [[Mara]]`, which resolves to nothing and matches no meeting.
    const viewText = vault.files.get(VIEW)?.text ?? '';
    const handled = preview.refusal?.includes(VIEW) === true || !viewText.includes('[[Mara]]');
    expect(handled).toBe(true);
  });
});
