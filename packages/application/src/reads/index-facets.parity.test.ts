import { describe, expect, it } from 'vitest';
import {
  compileGraphQuery,
  compileTagCountsQuery,
  type GraphQueryPart,
  type IndexFacet,
} from '@atlas/domain';
import type { IndexedNote, IndexPort } from '../index/ports.ts';
import { sqliteIndexPort } from '../testing/sqlite-index.ts';
import { reportingIndexWrites } from './reporting-index-writes.ts';

const prop = (key: string, index: number, text: string) => ({
  key,
  index,
  text,
  number: null,
  date: null,
  json: null,
});

const base: IndexedNote = {
  path: 'a.md',
  title: 'A',
  modified: 1,
  size: 1,
  digest: 'd',
  type: null,
  body: 'words',
  summary: '',
  properties: [],
  links: [],
  tags: [],
  relations: [],
  blocks: [],
  checks: [],
  progress: null,
};

/** Ways one note can be, each differing from the others in one thing or a few. */
const VARIANTS: Readonly<Record<string, IndexedNote>> = {
  plain: base,
  'other words': { ...base, body: 'other words', digest: 'e' },
  retitled: { ...base, title: 'Ay' },
  typed: { ...base, properties: [prop('type', 0, 'task')] },
  'typed twice': { ...base, properties: [prop('type', 0, 'task'), prop('type', 1, 'idea')] },
  'a status': { ...base, properties: [prop('status', 0, 'done')] },
  related: { ...base, properties: [prop('project', 0, '[[b]]')] },
  linked: { ...base, links: [{ target: 'b', name: 'b', path: 'b.md', kind: 'wikilink' }] },
  'linked twice': {
    ...base,
    links: [
      { target: 'b', name: 'b', path: 'b.md', kind: 'wikilink' },
      { target: 'b', name: 'b', path: 'b.md', kind: 'wikilink' },
    ],
  },
  'a link to nowhere': {
    ...base,
    links: [{ target: 'z', name: 'z', path: null, kind: 'wikilink' }],
  },
  'a markdown link': {
    ...base,
    links: [{ target: 'b.md', name: 'b', path: 'b.md', kind: 'markdown' }],
  },
  tagged: { ...base, tags: [{ key: 'x', name: 'x' }] },
  'tagged, spelt otherwise': { ...base, tags: [{ key: 'x', name: 'X' }] },
  'tagged twice': {
    ...base,
    tags: [
      { key: 'x', name: 'x' },
      { key: 'y', name: 'y' },
    ],
  },
};

const B: IndexedNote = { ...base, path: 'b.md', title: 'B', tags: [{ key: 'x', name: 'x' }] };

/** What the graph's statements and the tag counts answer, whole. */
async function readsOf(index: IndexPort): Promise<Record<IndexFacet, string>> {
  const answer = async ({ sql, parameters }: { sql: string; parameters: readonly unknown[] }) =>
    JSON.stringify((await index.query(sql, parameters as (string | number | null)[])).rows);
  const parts: GraphQueryPart[] = ['notes', 'links', 'relations'];
  const graph = await Promise.all(parts.map((part) => answer(compileGraphQuery(part, 0))));
  return { graph: graph.join('\n'), tags: await answer(compileTagCountsQuery(0)) };
}

describe('the facet check, beside what the graph and the tag counts read', () => {
  it('says a facet changed whenever what that facet’s statements answer changed', async () => {
    for (const [from, before] of Object.entries(VARIANTS)) {
      for (const [to, after] of Object.entries(VARIANTS)) {
        const index = sqliteIndexPort();
        await index.put([B, before]);
        const was = await readsOf(index);
        const reported = new Set<IndexFacet>();
        const wrapped = reportingIndexWrites({
          index,
          report: (facets) => facets.forEach((facet) => reported.add(facet)),
        });

        await wrapped.put([after]);
        const now = await readsOf(index);

        for (const facet of ['graph', 'tags'] as const) {
          if (now[facet] !== was[facet]) expect(reported, `${from} → ${to}`).toContain(facet);
        }
        if (from === to) expect([...reported], `${from} → itself`).toEqual([]);
      }
    }
  });
});
