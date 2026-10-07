import { describe, expect, it, vi } from 'vitest';
import { createVaultPath, type ParsedBody } from '@atlas/domain';
import { fakeIndexPort, fakeMarkdown, fakeVaultFs } from '../testing/fake-ports.ts';
import { searchNotes } from '../index/search-notes.ts';
import { findUnlinkedMentions, linkUnlinkedMention } from './unlinked-mentions.ts';

const TEMPLATE = '.atlas/templates/Meeting.md';
const TEMPLATE_TEXT = '---\ntype: meeting\n---\nAgenda for Acme.\n';

/** One block per paragraph: enough to show where a mention is. */
function parseBody(body: string): ParsedBody {
  const blocks = [...body.matchAll(/[^\n]+(?:\n[^\n]+)*/g)].map((match, index) => ({
    id: `b${index}`,
    index,
    source: match[0],
    start: match.index,
    end: match.index + match[0].length,
    normalized: match[0],
  }));
  return { blocks, doc: { type: 'doc', content: blocks.map(() => ({ type: 'paragraph' })) } };
}

const markdown = { ...fakeMarkdown(), parseBody };
const acme = { path: createVaultPath('Acme.md'), title: 'Acme' };
const hitsFor = (...paths: string[]) =>
  vi.fn(async () => paths.map((path) => ({ path, title: path, snippet: '' })));

describe('a template is never reached from a note flow (issue #15) — attacks', () => {
  it('does not offer a template as an unlinked mention', async () => {
    const found = await findUnlinkedMentions({
      index: fakeIndexPort({ search: hitsFor(TEMPLATE) }),
      fs: fakeVaultFs({
        readNotes: async (paths) =>
          paths.map((path) => ({ path, text: TEMPLATE_TEXT, modified: 1, size: 1 })),
      }),
      markdown,
      note: acme,
      linkedFrom: [],
    });
    expect(found.map((mention) => mention.path)).not.toContain(TEMPLATE);
  });

  it('does not write a link into a template from "Link" on an unlinked mention', async () => {
    const writeTextFile = vi.fn(async () => 2);
    await linkUnlinkedMention({
      index: fakeIndexPort({
        manifest: async () => [{ path: 'Acme.md', modified: 1, size: 1 }],
      }),
      fs: fakeVaultFs({
        readTextFile: async () => ({ text: TEMPLATE_TEXT, modified: 1 }),
        writeTextFile,
      }),
      markdown,
      openNotes: { state: () => 'closed', reload: vi.fn() },
      source: createVaultPath(TEMPLATE),
      target: acme,
    }).catch(() => false);
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it('does not land a search on a template', async () => {
    const hits = await searchNotes({
      index: fakeIndexPort({ search: hitsFor('Acme.md', TEMPLATE) }),
      query: 'acme',
      limit: 20,
      includeArchived: false,
    });
    expect(hits.map((hit) => hit.path)).not.toContain(TEMPLATE);
  });
});
