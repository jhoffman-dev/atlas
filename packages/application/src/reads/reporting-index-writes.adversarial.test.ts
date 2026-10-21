import { describe, expect, it } from 'vitest';
import { linkLeaf, type IndexFacet } from '@dfai/domain';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import type { IndexedNote, IndexPort } from '../index/ports.ts';
import { readVaultGraph } from '../graph/load-graph.ts';
import { reportingIndexWrites } from './reporting-index-writes.ts';

const note = (path: string, extra: Partial<IndexedNote> = {}): IndexedNote => ({
  path,
  title: path.replace(/\.md$/, ''),
  modified: 1,
  size: 1,
  digest: 'd',
  type: null,
  body: '',
  summary: '',
  properties: [],
  links: [],
  tags: [],
  relations: [],
  blocks: [],
  checks: [],
  progress: null,
  ...extra,
});

const linkTo = (path: string) => ({
  target: path,
  leaf: linkLeaf(path),
  path,
  kind: 'wikilink' as const,
});

/** A promise and the hand that settles it, so a test sets the order of every step. */
function gate() {
  let open: () => void = () => {};
  const shut = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { shut, open };
}

/**
 * The SQLite index, each put held twice: before it writes, and after it has
 * written but before it says so. That is the host's put as JavaScript sees it:
 * the rows land some time before the answer comes back.
 */
function heldIndex(base: IndexPort) {
  const held: { write: ReturnType<typeof gate>; answer: ReturnType<typeof gate> }[] = [];
  const index: IndexPort = {
    ...base,
    put: async (notes, scope) => {
      const step = { write: gate(), answer: gate() };
      held.push(step);
      await step.write.shut;
      await base.put(notes, scope);
      await step.answer.shut;
    },
  };
  return { index, held };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a tag whose spelling alone changes (PR 272)', () => {
  it('says the tags changed: the tags page shows the first spelling', async () => {
    const base = sqliteIndexPort();
    const reports: IndexFacet[][] = [];
    const wrapped = reportingIndexWrites({
      index: base,
      report: (facets) => reports.push([...facets].sort()),
    });
    await wrapped.put([note('a.md', { tags: [{ key: 'draft', name: 'draft' }] })]);
    reports.length = 0;

    await wrapped.put([note('a.md', { digest: 'e', tags: [{ key: 'draft', name: 'Draft' }] })]);

    expect(reports).toEqual([['tags']]);
  });
});

describe('two puts of one note whose checks overlap (PR 272)', () => {
  it('says the graph changed when a reader saw a link the last write took away', async () => {
    const base = sqliteIndexPort();
    await base.put([note('b.md'), note('a.md')]);
    const { index, held } = heldIndex(base);
    const reports: IndexFacet[][] = [];
    const wrapped = reportingIndexWrites({
      index,
      report: (facets) => reports.push([...facets].sort()),
    });

    // Typing adds a link to b, then takes it away again; each save is put.
    const linked = wrapped.put([note('a.md', { links: [linkTo('b.md')] })]);
    const unlinked = wrapped.put([note('a.md', { digest: 'e' })]);
    await settle();
    expect(held).toHaveLength(2); // both checked "before": a held no link

    held[0]?.write.open(); // the link lands
    await settle();
    // Something reads the graph now (another write's news): it shows a → b.
    const seen = await readVaultGraph({ index: base });
    expect(seen.edges).toHaveLength(1);

    held[1]?.write.open(); // the link is taken away
    held[1]?.answer.open();
    held[0]?.answer.open();
    await Promise.all([linked, unlinked]);
    expect((await readVaultGraph({ index: base })).edges).toHaveLength(0);

    // Each put saw "no link" before and after, so neither said anything, and
    // the graph read above, with its a → b edge, is kept.
    expect(reports).toContainEqual(['graph']);
  });
});
