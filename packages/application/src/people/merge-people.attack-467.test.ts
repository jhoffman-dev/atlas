import { describe, expect, it } from 'vitest';
import { createVaultPath, splitFrontmatter } from '@atlas/domain';
import type { IndexPort } from '../index/ports.ts';
import { refreshIndex } from '../index/refresh-index.ts';
import {
  jsonFrontmatterMarkdown as markdown,
  guardedVault,
  jsonFrontmatterNote as note,
} from '../testing/guarded-vault.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import {
  applyPeopleMerge,
  previewPeopleMerge,
  type MergePanes,
  type MergePorts,
} from './merge-people.ts';

/*
 * Adversarial probes of PR #467 (merge duplicate people, #464): re-runs,
 * chains, many holders and failures part-way. Fictional names only.
 */

const p = createVaultPath;

const closedPanes: MergePanes = {
  state: () => 'closed',
  flush: async () => {},
  abandon: () => {},
  reload: () => {},
};

/** The holders question, cut short at `rowCap` rows as the host cuts every answer (MAX_QUERY_ROWS = 5000). */
const HOLDERS_QUERY = 'SELECT DISTINCT src AS "path" FROM relations WHERE';

function cappedIndex(rowCap: number): IndexPort & { cuts: number } {
  const index = sqliteIndexPort();
  const capped: IndexPort & { cuts: number } = {
    cuts: 0,
    ...index,
    query: async (sql, parameters) => {
      const result = await index.query(sql, parameters);
      if (!sql.startsWith(HOLDERS_QUERY) || result.rows.length <= rowCap) return result;
      capped.cuts += 1;
      return { ...result, rows: result.rows.slice(0, rowCap), truncated: true };
    },
  };
  return capped;
}

async function setUp(entries: Record<string, string>, rowCap = 5000) {
  const vault = guardedVault(entries);
  const index = cappedIndex(rowCap);
  const ports: MergePorts = { fs: vault.fs, index, markdown, editors: closedPanes };
  const merge = async (keep: string, merged: string[]) => {
    await refreshIndex({ fs: vault.fs, index, markdown });
    const notePaths = [...vault.files.keys()].filter((path) => path.endsWith('.md')).map(p);
    const preview = await previewPeopleMerge({
      ports,
      request: { keep: p(keep), merge: merged.map(p) },
      notePaths,
    });
    return { preview, report: await applyPeopleMerge({ ports, preview }) };
  };
  return { vault, index, merge };
}

const KEPT = 'People/Mara Quill.md';
const SHORT = 'Mara.md';
const TYPO = 'Inbox/Marra Quill.md';

describe('a merge run again (attack-467)', () => {
  it('adds a merged body once when the merge is run again after the Trash refused that person', async () => {
    const { vault, merge } = await setUp({
      [KEPT]: note({ type: 'person' }, 'Leads payroll.\n'),
      [SHORT]: note({ type: 'person' }, 'Met at the kickoff.\n'),
    });
    vault.failTrash.add(SHORT);
    const first = await merge(KEPT, [SHORT]);
    expect(first.report.notTrashed).toEqual([SHORT]);
    vault.failTrash.clear();
    // The summary tells the person SHORT is still in the vault: they merge it again.
    await merge(KEPT, [SHORT]);
    const body = splitFrontmatter(vault.text(KEPT)!).body;
    expect(body.match(/## Merged from Mara\n/g)).toHaveLength(1);
  });

  it('stops at a failed third write with an exact report, and a second run finishes it once', async () => {
    const holders = ['A.md', 'B.md', 'C.md', 'D.md'];
    const { vault, merge } = await setUp({
      [KEPT]: note({ type: 'person' }, 'Leads payroll.\n'),
      [SHORT]: note({ type: 'person' }, 'Short copy.\n'),
      ...Object.fromEntries(holders.map((path) => [path, 'Ask [[Mara]].\n'])),
    });
    vault.failWrite.add('C.md');
    const { report } = await merge(KEPT, [SHORT]);
    expect(report).toMatchObject({
      written: ['A.md', 'B.md'],
      notWritten: ['C.md', 'D.md', KEPT],
      trashed: [],
      notTrashed: [SHORT],
      links: 2,
    });
    vault.failWrite.clear();
    const again = await merge(KEPT, [SHORT]);
    expect(again.report.written).toEqual(['C.md', 'D.md', KEPT]);
    for (const path of holders) expect(vault.text(path)).toBe('Ask [[Mara Quill]].\n');
    expect(splitFrontmatter(vault.text(KEPT)!).body.match(/## Merged from Mara\n/g)).toHaveLength(
      1,
    );
  });
});

describe('merges in a chain and three at once (attack-467)', () => {
  it('a merge of A into B, then B into C, leaves every link opening C and both old names among its aliases', async () => {
    const { vault, merge } = await setUp({
      'Mara.md': note({ type: 'person' }, ''),
      'Mara Q.md': note({ type: 'person' }, ''),
      [KEPT]: note({ type: 'person' }, ''),
      'Plan.md': 'Ask [[Mara]] and [[Mara Q]].\n',
    });
    await merge('Mara Q.md', ['Mara.md']);
    await merge(KEPT, ['Mara Q.md']);
    expect(vault.text('Plan.md')).toBe('Ask [[Mara Quill]] and [[Mara Quill]].\n');
    const properties = markdown.frontmatterProperties(
      splitFrontmatter(vault.text(KEPT)!).frontmatter,
    );
    expect(properties['aliases']).toEqual(['Mara Q', 'Mara']);
  });

  it('a three-way merge whose people link to themselves and each other leaves no link to a trashed note', async () => {
    const { vault, merge } = await setUp({
      [KEPT]: note({ type: 'person' }, 'See [[Mara]].\n'),
      [SHORT]: note(
        { type: 'person', related: ['[[Marra Quill]]'] },
        'Me: [[Mara#Notes]], [[Marra Quill|typo]].\n',
      ),
      [TYPO]: note({ type: 'person' }, 'Also ![[Mara]] and [[Mara Quill]].\n'),
    });
    const { report } = await merge(KEPT, [SHORT, TYPO]);
    expect(report.trashed).toEqual([SHORT, TYPO]);
    const text = vault.text(KEPT)!;
    expect(text).not.toMatch(/\[\[(Mara|Marra Quill)[\]#|]/u);
  });
});

describe('many notes linking to the merged person (attack-467)', () => {
  it('re-points every one of 5,100 holders, past any page the index cuts an answer at', async () => {
    const holders = Array.from(
      { length: 5100 },
      (_, at) => `Notes/n${String(at).padStart(5, '0')}.md`,
    );
    const { vault, index, merge } = await setUp({
      [KEPT]: note({ type: 'person' }, ''),
      [SHORT]: note({ type: 'person' }, 'Short copy.\n'),
      ...Object.fromEntries(holders.map((path) => [path, 'Ask [[Mara]].\n'])),
    });
    const { preview } = await merge(KEPT, [SHORT]);
    expect(index.cuts).toBeGreaterThan(0);
    expect(preview.writes).toHaveLength(holders.length + 1);
    expect(holders.filter((path) => vault.text(path) !== 'Ask [[Mara Quill]].\n')).toEqual([]);
  }, 60_000);
});
